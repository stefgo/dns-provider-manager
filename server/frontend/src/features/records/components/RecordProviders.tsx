import { useId, useMemo, useState } from "react";
import { PROVIDER_CAPABILITIES, type DnsRecord, type Provider, type RecordInput, type RecordLinkView } from "@dpm/shared";
import {
    Alert,
    Badge,
    Button,
    DataTable,
    FieldLabel,
    Input,
    LoadingIndicator,
    Switch,
    type DataTableDef,
} from "@stefgo/react-ui-components";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { useRecordPreview } from "../../../queries/records";
import { getErrorMessage } from "../../../utils";
import { useLinkActions } from "../hooks/useLinkActions";
import { DEFAULT_SETTING, type SettingDraft } from "../lib/recordForm";
import { providerName, providerRows, type ProviderCell, type ProviderRow } from "../lib/recordSync";

interface RecordProvidersProps {
    /** The stored record; null while it is being added. */
    record: DnsRecord | null;
    /** The draft as the request takes it, while it is valid. */
    input: RecordInput | null;
    isDirty: boolean;
    providers: Provider[];
    /** TTL and proxy per provider, as typed, and what is wrong with each TTL. */
    settings: Record<string, SettingDraft>;
    settingErrors: Record<string, string>;
    onSetting: (providerId: string, change: Partial<SettingDraft>) => void;
}

/** A cell with nothing to say: a setting the provider does not know or is not offered, a state it does not have. */
const NotOffered = () => <span className="text-text-muted">–</span>;

/** A state or a change as a badge, with what it says below. */
const CellBadge = ({ cell }: { cell: ProviderCell | null }) =>
    cell ? (
        <>
            <Badge variant={cell.tone} className="whitespace-nowrap">
                {cell.text}
            </Badge>
            {cell.detail && <span className="mt-1 block text-xs text-text-muted">{cell.detail}</span>}
        </>
    ) : (
        <NotOffered />
    );

/** Whether the provider's state is one "Write again" and "Take over" answer. */
const needsAnswer = (link: RecordLinkView | null): link is RecordLinkView => link?.status === "drift" || link?.status === "missing";

/**
 * Where the record stands at each provider, with what can be done about drift -- and, while
 * the draft differs from what is stored, what saving would do at each one, in a column of its
 * own. The preview follows the draft once typing pauses. Every provider the record goes to
 * has its TTL and proxy here, as far as it knows them.
 *
 * The rows stay one table, keyed by provider, so a field being typed into is not replaced
 * while the preview catches up -- and a draft that is not valid for a moment keeps the last
 * preview rather than losing its column.
 */
export const RecordProviders = ({ record, input, isDirty, providers, settings, settingErrors, onSetting }: RecordProvidersProps) => {
    const actions = useLinkActions();
    const errorIdPrefix = useId();
    const wanted = isDirty || !record;
    // By its text, so a draft that renders again without a change asks nothing new.
    const fresh = wanted && input ? JSON.stringify({ id: record?.id, record: input }) : null;
    const [kept, setKept] = useState<string | null>(null);
    if (fresh !== null && fresh !== kept) setKept(fresh);
    const settled = useDebouncedValue(wanted ? (fresh ?? kept ?? "null") : "null", 400);
    const request = useMemo(() => JSON.parse(settled) as { id?: string; record: RecordInput } | null, [settled]);
    const preview = useRecordPreview(request);
    const providerOf = (id: string) => providers.find((p) => p.id === id);
    const writable = (id: string) => providerOf(id)?.writable ?? false;
    const showsPreview = request !== null && preview.data !== undefined;

    const rows = providerRows(record, showsPreview ? preview.data! : null, providers);

    // What a provider of the table knows; the columns are there either way, "–" where it does not.
    const capsOf = (row: ProviderRow) => {
        const provider = providerOf(row.providerId);
        return row.settable && provider ? PROVIDER_CAPABILITIES[provider.type] : null;
    };
    // Not while the preview is shown: what they do would change the record under the draft.
    const anyAnswer = !showsPreview && rows.some((row) => needsAnswer(row.link));
    const settingOf = (row: ProviderRow) => settings[row.providerId] ?? DEFAULT_SETTING;
    const errorId = (row: ProviderRow) => `${errorIdPrefix}-ttl-${row.providerId}`;
    // Below the table rather than below the field, so a row does not grow while its TTL is typed.
    const ttlErrors = rows.filter((row) => capsOf(row)?.ttl && settingErrors[row.providerId]);

    const columns: DataTableDef<ProviderRow>[] = [
        {
            tableHeader: "Provider",
            tableItemRender: (row) => <span className="font-medium">{providerName(row.providerId, providers)}</span>,
        },
    ];
    if (record) {
        columns.push({
            tableHeader: "State",
            tableCellClassName: "whitespace-normal",
            tableItemRender: (row) => <CellBadge cell={row.state} />,
        });
    }
    // Always there, so the columns do not move once a change is typed; "–" while there is no preview.
    // As wide as its longest badge ("Takes over the entry it holds") from the start, for the same reason.
    // On the heading's content: a table cell's own min-width is not something every browser keeps.
    columns.push({
        tableHeader: <span className="block min-w-56">On save</span>,
        tableCellClassName: "whitespace-normal",
        tableItemRender: (row) => <CellBadge cell={row.change} />,
    });
    // Always there, like "On save", so the table keeps its shape whichever providers it lists --
    // and the TTL as wide as its field, so the column does not grow once a row offers one.
    columns.push(
        {
            tableHeader: <span className="block min-w-28">TTL</span>,
            tableItemRender: (row) => {
                const caps = capsOf(row);
                if (!caps?.ttl) return <NotOffered />;
                const setting = settingOf(row);
                const invalid = Boolean(settingErrors[row.providerId]);
                return (
                    <Input
                        aria-label={`TTL at ${providerName(row.providerId, providers)}`}
                        aria-invalid={invalid || undefined}
                        aria-describedby={invalid ? errorId(row) : undefined}
                        title={setting.proxied ? "Cloudflare sets the TTL to Auto while it proxies" : "TTL in seconds; empty is the provider's default"}
                        inputMode="numeric"
                        className="w-28"
                        // A number to the right, the placeholder where text starts.
                        classNames={{ input: `py-1.5 text-right placeholder-shown:text-left${invalid ? " border-error" : ""}` }}
                        value={setting.ttl}
                        onChange={(e) => onSetting(row.providerId, { ttl: e.target.value })}
                        placeholder="Default"
                        disabled={caps.proxied && setting.proxied}
                    />
                );
            },
        },
        {
            tableHeader: "Proxied",
            tableItemRender: (row) =>
                capsOf(row)?.proxied ? (
                    <Switch
                        aria-label={`Proxied at ${providerName(row.providerId, providers)}`}
                        value={settingOf(row).proxied}
                        onChange={(on) => onSetting(row.providerId, { proxied: on })}
                    />
                ) : (
                    <NotOffered />
                ),
        },
    );
    if (anyAnswer && record) {
        columns.push({
            tableHeader: <span className="sr-only">Actions</span>,
            tableItemRender: (row) =>
                needsAnswer(row.link) && (
                    <span className="flex justify-end gap-2">
                        {writable(row.providerId) && (
                            <Button type="button" size="sm" variant="secondary" onClick={() => actions.rewrite(record, row.link!)}>
                                Write again
                            </Button>
                        )}
                        <Button type="button" size="sm" variant="secondary" onClick={() => actions.accept(record, row.link!)}>
                            Take over
                        </Button>
                    </span>
                ),
        });
    }

    return (
        <div>
            <FieldLabel as="div">Providers</FieldLabel>
            {request !== null && preview.error && <Alert title="Could not work out what saving does">{getErrorMessage(preview.error)}</Alert>}
            {request !== null && !preview.data && !preview.error && <LoadingIndicator label="Working out what saving does…" />}
            {showsPreview && preview.data!.conflict && <Alert>{preview.data!.conflict}</Alert>}
            {(showsPreview || record) && (
                <DataTable
                    data={rows}
                    keyField="providerId"
                    itemDef={columns}
                    emptyMessage={showsPreview ? "Nothing is written: its sites write to no provider." : "Its sites write to no provider."}
                    // The card's background, not the table row's: on that an input looks like the editor's other fields.
                    className="rounded-lg border-border bg-card shadow-none"
                    classNames={{ contentWrapper: "overflow-x-auto", th: "px-3", td: "h-12 px-3", placeholderTd: "py-3 text-sm" }}
                />
            )}
            {ttlErrors.map((row) => (
                <p key={row.providerId} id={errorId(row)} className="mt-1.5 text-sm text-error">
                    TTL at {providerName(row.providerId, providers)}: {settingErrors[row.providerId]}
                </p>
            ))}
            {request === null && !record && <p className="py-1.5 text-sm text-text-muted">Fill in the record to see where it goes.</p>}
        </div>
    );
};
