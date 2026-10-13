import { SubscriptionPurchaseRequestsPanel } from "@/components/SubscriptionPurchaseRequests";

export default function SubscriptionPurchaseRequestsPage() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <SubscriptionPurchaseRequestsPanel standalone />
    </div>
  );
}