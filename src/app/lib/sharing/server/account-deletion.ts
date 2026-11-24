import { linkObject, moderationObject, planObject, userObject, type DurableBindings } from "@/app/lib/durable/access";
import { accountConfig, workosClient } from "@/app/lib/account/server";
import { ownerDeparting } from "./plan-service";

/**
 * Account deletion (§14.4): each step is recorded and idempotent, so the user's alarm can resume
 * from the first unfinished one after a failure.
 * 1. The account is marked as being deleted: writes, link opens, joins and transfers to it stop.
 * 2. Every build and group link is revoked and the builds and groups are deleted.
 * 3. Each owned plan passes to its next member, or is deleted if it has none.
 * 4. Each shared plan drops the user; their ops lose their author, the content stays.
 * 5. The WorkOS user is deleted, as before.
 * 6. Reports about their items close, and the object is wiped.
 */
export async function runAccountDeletion(env: DurableBindings, userId: string): Promise<"done" | "pending"> {
  const user = userObject(env, userId);
  await user.beginDeletion();
  const step = async (name: string, work: () => Promise<void>) => {
    if (await user.deletionStepDone(name)) return;
    await work();
    await user.markDeletionStep(name);
  };
  try {
    await step("content", async () => {
      const codes = await user.deleteLibraryContent();
      await Promise.all(codes.map((code) => linkObject(env, code).destroy().catch(() => undefined)));
    });
    await step("owned_plans", async () => {
      for (const planId of await user.planIds("owned")) {
        if ((await planObject(env, planId).ownerId()) === userId) await ownerDeparting(env, userId, planId);
        await user.forgetPlan(planId);
      }
    });
    await step("shared_plans", async () => {
      for (const planId of await user.planIds("shared")) {
        await planObject(env, planId).removeDeletedAccount(userId);
        await user.forgetPlan(planId);
      }
    });
    await step("workos", async () => {
      const config = accountConfig();
      // Development users (DEV_AUTH) have no WorkOS user.
      if (config && !userId.startsWith("user_dev_")) await workosClient(config).userManagement.deleteUser(userId);
    });
    await step("reports", async () => {
      await moderationObject(env).closeCasesFor("user", userId);
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "account_deletion_retry", error: String(error) }));
    await user.retryDeletionLater();
    return "pending";
  }
  await user.wipe();
  return "done";
}
