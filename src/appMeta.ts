export type AppMeta = {
  version: string;
  updatedAt: string;
  commitHash: string | null;
  commitMessage: string;
};

declare const __APP_META__: AppMeta | undefined;

export const appMeta: AppMeta = typeof __APP_META__ !== "undefined"
  ? __APP_META__
  : {
      version: "v1.3.5",
      updatedAt: new Date(0).toISOString(),
      commitHash: null,
      commitMessage: "Local build metadata unavailable",
    };
