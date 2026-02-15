import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { mutation } from "@/convex/_generated/server";
import { v } from "convex/values";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Password, Anonymous],
});

export const checkPasswordAccount = mutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const raw = args.email.trim();
    if (!raw) {
      return { ok: true } as const;
    }

    // Perform lookup for internal tracking/logging but don't leak result
    const candidates = raw.toLowerCase() === raw ? [raw] : [raw, raw.toLowerCase()];

    for (const candidate of candidates) {
      await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", candidate)
        )
        .unique();
    }

    // Always return generic response to prevent account enumeration
    return { ok: true } as const;
  },
});
