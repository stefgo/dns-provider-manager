import { useState, type KeyboardEvent, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Trash2 } from "lucide-react";
import { ActionButton, FOCUS_RING, FieldLabel, cn } from "@stefgo/react-ui-components";

const LINK_BUTTON = cn("rounded-sm text-xs font-bold text-primary hover:underline", FOCUS_RING);

/** The details an item opens to, one `InfoRow` per line. */
export const InfoGrid = ({ children }: { children: ReactNode }) => (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border bg-app-bg px-12 py-3 text-xs">
        {children}
    </div>
);

export const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
    <>
        <span className="text-text-muted">{label}:</span>
        <span className="break-all text-text-primary">{children}</span>
    </>
);

interface MultiSelectFieldProps<T extends { id: string }> {
    items: T[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    /** Whether the list to pick from is open. The editor holds it: Escape closes it first. */
    isSelecting: boolean;
    onSetIsSelecting: (selecting: boolean) => void;
    /** The field's label, as in "Providers"; the list says "Select Providers". */
    label: string;
    /** The line of an item, in the box and in the list. */
    renderName: (item: T) => ReactNode;
    /** What an item's row opens to, usually an `InfoGrid`. */
    renderInfo: (item: T) => ReactNode;
    removeTooltip: string;
    noneSelected: string;
    /** Shown in the list when there is nothing to pick from. */
    emptyList: ReactNode;
    hint?: ReactNode;
    error?: string;
}

/**
 * Several items picked for an editor, the way pbcm's job editor shows its repository: the
 * chosen ones in a box, each opening to its details and removable on its own, and a list to
 * pick from in their place. A click in the list ticks or unticks one, and the list stays open
 * until "Done".
 */
export const MultiSelectField = <T extends { id: string }>({
    items,
    selectedIds,
    onChange,
    isSelecting,
    onSetIsSelecting,
    label,
    renderName,
    renderInfo,
    removeTooltip,
    noneSelected,
    emptyList,
    hint,
    error,
}: MultiSelectFieldProps<T>) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const isSelected = (item: T) => selectedIds.includes(item.id);
    const toggle = (item: T) =>
        onChange(isSelected(item) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id]);

    const expandButton = (item: T) => {
        const expanded = expandedId === item.id;
        return (
            <ActionButton
                icon={expanded ? ChevronDown : ChevronRight}
                size="sm"
                tooltip={expanded ? "Collapse" : "Expand"}
                onClick={(e) => {
                    e.stopPropagation();
                    setExpandedId(expanded ? null : item.id);
                }}
            />
        );
    };

    const footer = (
        <>
            {error && <p className="text-xs text-error">{error}</p>}
            {hint && <p className="text-xs text-text-muted">{hint}</p>}
        </>
    );

    if (isSelecting) {
        const onRowKey = (e: KeyboardEvent, item: T) => {
            if (e.target !== e.currentTarget || (e.key !== " " && e.key !== "Enter")) return;
            e.preventDefault();
            toggle(item);
        };

        return (
            <div className="space-y-1">
                <div className="flex items-center justify-between">
                    <FieldLabel as="div" className="mb-0 ml-0">
                        Select {label}
                    </FieldLabel>
                    <button type="button" onClick={() => onSetIsSelecting(false)} className={LINK_BUTTON}>
                        Done
                    </button>
                </div>

                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {items.map((item) => (
                        <div key={item.id} className="flex flex-col">
                            <div
                                role="checkbox"
                                aria-checked={isSelected(item)}
                                tabIndex={0}
                                onClick={() => toggle(item)}
                                onKeyDown={(e) => onRowKey(e, item)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-hover",
                                    FOCUS_RING,
                                )}
                            >
                                {expandButton(item)}
                                <div className="flex min-w-0 items-center gap-2">
                                    {isSelected(item) ? (
                                        <CheckCircle2 size={18} className="shrink-0 animate-pulse-soft text-primary" />
                                    ) : (
                                        <Circle size={18} className="shrink-0 text-border" />
                                    )}
                                    {renderName(item)}
                                </div>
                            </div>
                            {expandedId === item.id && renderInfo(item)}
                        </div>
                    ))}
                    {items.length === 0 && <div className="p-8 text-center text-sm text-text-muted">{emptyList}</div>}
                </div>
                {footer}
            </div>
        );
    }

    const selected = items.filter(isSelected);

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <FieldLabel as="div" className="mb-0 ml-0">
                    {label}
                </FieldLabel>
                <button type="button" onClick={() => onSetIsSelecting(true)} className={LINK_BUTTON}>
                    {selected.length > 0 ? `Change ${label}` : `Add ${label}`}
                </button>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-app-bg p-2">
                {selected.map((item) => (
                    <div key={item.id} className="overflow-hidden rounded border border-border bg-card">
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                                {expandButton(item)}
                                {renderName(item)}
                            </div>
                            <ActionButton
                                icon={Trash2}
                                size="sm"
                                color="orange"
                                tooltip={removeTooltip}
                                onClick={() => toggle(item)}
                            />
                        </div>
                        {expandedId === item.id && renderInfo(item)}
                    </div>
                ))}
                {selected.length === 0 && <div className="px-1 py-2 text-text-muted">{noneSelected}</div>}
            </div>
            {footer}
        </div>
    );
};
