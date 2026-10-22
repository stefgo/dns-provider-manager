import type { ConfirmOptions } from "@stefgo/react-ui-components";
import type { Provider } from "@dpm/shared";

/** Deleting a provider takes it out of its sites and forgets its credentials. */
export function describeDeleteProvider(provider: Pick<Provider, "name" | "siteIds">): ConfirmOptions {
    const sites = provider.siteIds.length;
    return {
        title: `Delete the provider "${provider.name}"?`,
        description: `${sites > 0 ? `It leaves ${sites === 1 ? "the site" : `the ${sites} sites`} it belongs to, and its` : "Its"} stored credentials are deleted. Records at the DNS server itself stay as they are.`,
        confirmLabel: "Delete provider",
        variant: "danger",
    };
}
