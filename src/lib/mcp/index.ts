import { auth, defineMcp } from "@lovable.dev/mcp-js";
import myProfileTool from "./tools/my-profile";
import myBookingsTool from "./tools/my-bookings";
import mySubscriptionsTool from "./tools/my-subscriptions";
import scheduleTool from "./tools/schedule";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "equus",
  title: "Equus",
  version: "0.1.0",
  instructions:
    "Tools for the Equus riding school. Use `schedule_for_date` to see lesson times and free places on a date, " +
    "`my_bookings` for the signed-in rider's lessons, `my_subscriptions` for their subscriptions (abonementai), " +
    "and `my_profile` for their profile. All data is scoped to the signed-in rider.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [scheduleTool, myBookingsTool, mySubscriptionsTool, myProfileTool],
});
