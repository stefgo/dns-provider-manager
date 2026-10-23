import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Edit2, MoreVertical, RefreshCw, Trash2 } from "lucide-react";
import { PROVIDER_TYPE_LABELS, type Provider } from "@dpm/shared";
import {
    ActionButton,
    ActionMenu,
    Alert,
    Badge,
    EntityHeader,
    LoadingIndicator,
    MenuItem,
    StatusDot,
    useActionMenu,
    useConfirm,
    useToast,
    type EntityDetail,
} from "@stefgo/react-ui-components";
import { QueryError } from "../../../components/QueryError";
import { RelativeTime } from "../../../components/RelativeTime";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { NotFoundError } from "../../../lib/notFound";
import { paths } from "../../../lib/paths";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { readProvider, useDeleteProvider, useProviders } from "../../../queries/providers";
import { useRecords } from "../../../queries/records";
import { useSites } from "../../../queries/sites";
import { EMPTY_VALUE, describeFailure, formatDate, plural } from "../../../utils";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { describeDeleteProvider } from "../confirmations";
import { SECRET_LABEL } from "../lib/providerForm";
import { accessDetails, connectionDetails, readTone, usedZones, type ProviderDetailLine } from "../lib/providerDetails";
import { recordCounts } from "../lib/providerRecords";

/** `/providers/:providerId`, read from the list like the editor. */
export const ProviderDetailRoute = () => {
    const { providerId } = useParams();
    const { providers, isPending, error } = useProviders();
    // Set while this page deletes its provider: the list is read again before the page is
    // left, and a provider missing from it then is no stale link.
    const [deleting, setDeleting] = useState(false);
    const provider = providers.find((p) => p.id === providerId);

    if (!provider && deleting) return null;
    if (!provider && error) return <QueryError title="Could not load the provider" error={error} />;
    if (!provider && isPending) return <LoadingIndicator label="Loading provider…" />;
    if (!provider) throw new NotFoundError("provider");
    return <ProviderDetail key={provider.id} provider={provider} onDeleting={setDeleting} />;
};

const asDetail = (line: ProviderDetailLine, visibility?: EntityDetail["visibility"]): EntityDetail => ({
    ...line,
    visibility,
});

interface ProviderDetailProps {
    provider: Provider;
    /** Told before the delete goes out, and again if it was refused. */
    onDeleting: (deleting: boolean) => void;
}

/**
 * The page about one provider. Its header carries what the list has no room for: where the
 * provider is reached, how its last reading went, which zones it uses.
 */
export const ProviderDetail = ({ provider, onDeleting }: ProviderDetailProps) => {
    const navigate = useNavigate();
    const back = useBackPath();
    const { confirm } = useConfirm();
    const { show } = useToast();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { sites } = useSites();
    const { records } = useRecords();
    const deleteProvider = useDeleteProvider();

    useEscapeToLeave(back);

    // What the reading found arrives through the socket. Only a request that failed is said.
    const read = () =>
        readProvider(provider.id).catch((err) =>
            show({ variant: "error", ...describeFailure(`Could not read ${provider.name}`, err), duration: 0 }),
        );

    // A refusal keeps the dialog open, with the server's reason in it.
    const requestDelete = () =>
        confirm({
            ...describeDeleteProvider(provider),
            onConfirm: async () => {
                onDeleting(true);
                try {
                    await deleteProvider.mutateAsync(provider.id);
                } catch (err) {
                    onDeleting(false);
                    throw err;
                }
                navigate(back);
            },
        });

    const memberOf = sites.filter((s) => provider.siteIds.includes(s.id));
    const count = recordCounts(records).get(provider.id) ?? { total: 0, problems: 0 };
    const zones = usedZones(provider);
    // AdGuard Home has no zones.
    const hasZones = provider.type !== "adguard";

    const details: EntityDetail[] = [
        ...connectionDetails(provider).map((line) => asDetail(line, "always")),
        {
            label: "Last Reading",
            value: provider.lastSeenAt ? (
                <>
                    <RelativeTime date={provider.lastSeenAt} />
                    {hasZones && <> · {plural(zones.length, "zone")}</>}
                </>
            ) : (
                "Not read yet"
            ),
            visibility: "always",
        },
        {
            label: "Records",
            value: (
                <>
                    {count.total}
                    {count.problems > 0 && <span className="text-error"> · {count.problems} to look at</span>}
                </>
            ),
            visibility: "always",
        },
        ...accessDetails(provider).map((line) => asDetail(line)),
        { label: SECRET_LABEL[provider.type], value: provider.hasSecret ? "Stored" : "Not stored" },
        { label: "Read Only", value: provider.readOnly ? "Yes" : "No" },
        { label: "Correct Drift by Itself", value: provider.autoCorrect ? "Yes" : "No" },
        ...(hasZones
            ? [
                  {
                      label: "Zones Used",
                      value: zones.length > 0 ? zones.map((z) => z.name).join(", ") : EMPTY_VALUE,
                      span: "full" as const,
                  },
              ]
            : []),
        { label: "Created", value: formatDate(provider.createdAt) },
        { label: "Updated", value: formatDate(provider.updatedAt) },
        { label: "ID", value: provider.id, copyable: provider.id },
    ];

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<StatusDot tone={readTone(provider)} size="md" />}
                title={<HeaderBreadcrumb>{provider.name}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={
                    <>
                        <Badge variant="neutral">{PROVIDER_TYPE_LABELS[provider.type]}</Badge>
                        {!provider.writable && <Badge variant="warning">Read only</Badge>}
                        {memberOf.map((s) => (
                            <Badge key={s.id} variant="info">
                                {s.name}
                            </Badge>
                        ))}
                    </>
                }
                alert={
                    provider.lastError !== null && (
                        <Alert title="Cannot be read">
                            <span className="break-words">{provider.lastError}</span>
                        </Alert>
                    )
                }
                details={details}
                // Open until the reader closes it: the details are what the page is for.
                defaultValue={true}
                // Names the view, not the provider: one entry for every provider page.
                persist={{ key: STORAGE_KEYS.providerDetails, scope: "local" }}
                actions={
                    <div className="relative">
                        <ActionButton
                            icon={MoreVertical}
                            aria-label="Provider actions"
                            onClick={(e) => openMenu(e, provider.id)}
                        />
                        <ActionMenu
                            isOpen={menuState?.id === provider.id}
                            onClose={closeMenu}
                            anchor={menuState?.anchor ?? null}
                            triggerRef={triggerRef}
                        >
                            <MenuItem icon={Edit2} onClick={() => navigate(paths.providerEdit(provider.id))}>
                                Edit
                            </MenuItem>
                            {provider.readable && (
                                <MenuItem icon={RefreshCw} onClick={read}>
                                    Read Now
                                </MenuItem>
                            )}
                            <MenuItem icon={Trash2} variant="danger" onClick={requestDelete}>
                                Delete
                            </MenuItem>
                        </ActionMenu>
                    </div>
                }
            />
        </div>
    );
};
