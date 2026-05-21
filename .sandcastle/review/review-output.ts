import { z } from "zod";

export const ReviewOutput = z.object({
  summary: z.string().min(1),
  inlineComments: z
    .array(
      z
        .object({
          path: z.string().min(1).optional(),
          file: z.string().min(1).optional(),
          line: z.coerce.number().int().positive().optional(),
          lineRange: z.string().optional(),
          body: z.string().min(1).optional(),
          comment: z.string().min(1).optional(),
        })
        .transform((c, ctx) => {
          const path = c.path ?? c.file;
          const body = c.body ?? c.comment;

          let line = c.line;
          if (line == null && c.lineRange != null) {
            const match = c.lineRange.match(/^(\d+)/);
            line = match ? parseInt(match[1]!, 10) : undefined;
          }

          if (!path) {
            ctx.addIssue({
              code: "custom",
              message: "inline comment missing 'path' (or 'file')",
            });
            return z.NEVER;
          }
          if (line == null || line < 1) {
            ctx.addIssue({
              code: "custom",
              message:
                "inline comment missing 'line' (or 'lineRange' with a valid number)",
            });
            return z.NEVER;
          }
          if (!body) {
            ctx.addIssue({
              code: "custom",
              message: "inline comment missing 'body' (or 'comment')",
            });
            return z.NEVER;
          }
          return { path, line, body };
        })
    )
    .default([]),
  replies: z
    .array(
      z.object({
        commentId: z.string().min(1),
        body: z.string().min(1),
      })
    )
    .default([]),
});

export type ReviewOutput = z.infer<typeof ReviewOutput>;
