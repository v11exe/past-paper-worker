import type { FeedbackEnv } from "../../_shared/feedbackProxy";
import { RESEND_ENDPOINT } from "../../_shared/feedbackProxy";

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

export const onRequestPost: PagesFunction<AdminEnv> = async (context) => {
  const { request, env } = context;

  const code = request.headers.get("x-admin-code");
  const expectedCode = env.ADMIN_CODE;

  if (!expectedCode) {
    return json({ ok: false, error: "Admin code not configured." }, 503);
  }

  if (!code || code !== expectedCode) {
    return json({ ok: false, error: "Invalid admin code." }, 401);
  }

  let body: { feedbackId?: string; replyText?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const { feedbackId, replyText } = body;

  if (!feedbackId || !replyText || typeof replyText !== "string" || replyText.trim().length === 0) {
    return json({ ok: false, error: "Missing feedbackId or replyText." }, 400);
  }

  if (replyText.length > 2000) {
    return json({ ok: false, error: "Reply text must be 2000 characters or fewer." }, 400);
  }

  try {
    const kv = env.FEEDBACK_KV;
    if (!kv) {
      return json({ ok: false, error: "KV store not configured." }, 503);
    }

    const stored = await kv.get(feedbackId);
    if (!stored) {
      return json({ ok: false, error: "Feedback entry not found." }, 404);
    }

    const entry = JSON.parse(stored);

    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
      return json({ ok: false, error: "Resend API key not configured." }, 503);
    }

    const emailPayload = {
      from: "Revision Feedback <feedback@omair.uk>",
      to: entry.email,
      subject: `Re: ${entry.title}`,
      text: `Hi,\n\n${replyText.trim()}\n\n---\nYour original message:\n${entry.description}`,
      html: `<p>Hi,</p><p>${replyText.trim().replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p><hr><p><em>Your original message:</em></p><p>${entry.description.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
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
      return json({ ok: false, error: `Failed to send reply email: ${errorBody}` }, 502);
    }

    const updatedEntry = {
      ...entry,
      repliedAt: new Date().toISOString(),
      replyText: replyText.trim(),
    };

    await kv.put(feedbackId, JSON.stringify(updatedEntry));

    return json({ ok: true, entry: updatedEntry });
  } catch (err) {
    return json({ ok: false, error: "Failed to send reply." }, 500);
  }
};