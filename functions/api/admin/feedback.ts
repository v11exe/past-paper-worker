import { z } from "zod";
import { RESEND_ENDPOINT } from "../_shared/feedbackProxy";

type AdminEnv = {
  ADMIN_CODE?: string;
  RESEND_API_KEY?: string;
  FEEDBACK_KV?: KVNamespace;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function authenticate(request: Request, env: AdminEnv) {
  const code = request.headers.get("x-admin-code");
  const expectedCode = env.ADMIN_CODE;

  if (!expectedCode) {
    return { ok: false, error: "Admin code not configured.", status: 503 };
  }

  if (!code || code !== expectedCode) {
    return { ok: false, error: "Invalid admin code.", status: 401 };
  }

  return { ok: true };
}

export const onRequestGet: PagesFunction<AdminEnv> = async (context) => {
  const { request, env } = context;

  const auth = authenticate(request, env);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status);
  }

  try {
    const kv = env.FEEDBACK_KV;
    if (!kv) {
      return json({ ok: false, error: "KV store not configured." }, 503);
    }

    const list = await kv.list({ limit: 100 });
    const entries: Array<Record<string, unknown>> = [];

    for (const key of list.keys) {
      const value = await kv.get(key.name);
      if (value) {
        try {
          entries.push(JSON.parse(value));
        } catch {
          // Skip invalid entries
        }
      }
    }

    entries.sort((a, b) => {
      const tsA = (a.context as Record<string, unknown>)?.timestamp as string;
      const tsB = (b.context as Record<string, unknown>)?.timestamp as string;
      return new Date(tsB).getTime() - new Date(tsA).getTime();
    });

    const sanitized = entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      email: entry.email,
      title: entry.title,
      description: (entry.description as string)?.slice(0, 500) + ((entry.description as string)?.length ?? 0 > 500 ? "..." : ""),
      context: entry.context,
      metadata: entry.metadata,
      attachments: entry.attachments,
      repliedAt: entry.repliedAt ?? null,
      replyText: entry.replyText ?? null,
    }));

    return json({ ok: true, entries: sanitized });
  } catch {
    return json({ ok: false, error: "Failed to fetch feedback entries." }, 500);
  }
};

const replyRequestSchema = z.object({
  feedbackId: z.string().min(1),
  replyText: z.string().min(1).max(2000),
});

export const onRequestPost: PagesFunction<AdminEnv> = async (context) => {
  const { request, env } = context;

  const auth = authenticate(request, env);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const parsed = replyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Missing feedbackId or replyText." }, 400);
  }

  const { feedbackId, replyText } = parsed.data;

  try {
    const kv = env.FEEDBACK_KV;
    if (!kv) {
      return json({ ok: false, error: "KV store not configured." }, 503);
    }

    const stored = await kv.get(feedbackId);
    if (!stored) {
      return json({ ok: false, error: "Feedback entry not found." }, 404);
    }

    const entry = JSON.parse(stored) as Record<string, unknown>;

    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
      return json({ ok: false, error: "Resend API key not configured." }, 503);
    }

    const emailPayload = {
      from: "Revision Feedback <feedback@omair.uk>",
      to: String(entry.email),
      subject: `Re: ${String(entry.title)}`,
      text: `Hi,\n\n${replyText}\n\n---\nYour original message:\n${String(entry.description)}`,
      html: `<p>Hi,</p><p>${replyText.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p><hr><p><em>Your original message:</em></p><p>${String(entry.description).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    };

    const resendResponse = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      return json({ ok: false, error: `Failed to send reply: ${errorBody}` }, 502);
    }

    const updatedEntry = {
      ...entry,
      repliedAt: new Date().toISOString(),
      replyText,
    };

    await kv.put(feedbackId, JSON.stringify(updatedEntry));

    return json({ ok: true, entry: updatedEntry });
  } catch {
    return json({ ok: false, error: "Failed to send reply." }, 500);
  }
};