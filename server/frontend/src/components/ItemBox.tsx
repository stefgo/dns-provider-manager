import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ActionButton, FOCUS_RING, FieldLabel, cn } from "@stefgo/react-ui-components";

const LINK_BUTTON = cn("rounded-sm text-xs font-bold text-primary hover:underline", FOCUS_RING);

/** A small text button beside a field's label: "Add Providers", "Done". */
export const LinkButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
    <button type="button" onClick={onClick} className={LINK_BUTTON}>
        {children}
    </button>
);

/** Opens and closes what an item's row opens to. */
export const ExpandButton = ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <ActionButton
        icon={expanded ? ChevronDown : ChevronRight}
        size="sm"
        tooltip={expanded ? "Collapse" : "Expand"}
        onClick={(e) => {
            e.stopPropagation();
            onToggle();
        }}
    />
);

interface ItemBoxProps<T extends { id: string }> {
    /** The field's label, as in "Providers". */
    label: string;
    /** The button beside the label: "Change Providers", "Add Node". */
    action?: { label: string; onClick: () => void };
    items: readonly T[];
    /** The line of an item. */
    renderName: (item: T) => ReactNode;
    /** What an item's row opens to, usually an `InfoGrid`. */
    renderInfo: (item: T) => ReactNode;
    /** The buttons at the end of an item's row. */
    renderActions: (item: T) => ReactNode;
    /** In the box when it holds nothing. */
    empty: ReactNode;
    /** Below the box: an error, a hint. */
    footer?: ReactNode;
}

/**
 * The items an editor holds, the way pbcm's job editor shows its repository: in a box, each
 * row opening to its details and ending in its own buttons. What a site's providers and a
 * cluster's nodes are shown in.
 */
export const ItemBox = <T extends { id: string }>({ label, action, items, renderName, renderInfo, renderActions, empty, footer }: ItemBoxProps<T>) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <FieldLabel as="div" className="mb-0">
                    {label}
                </FieldLabel>
                {action && <LinkButton onClick={action.onClick}>{action.label}</LinkButton>}
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-app-bg p-2">
                {items.map((item) => (
                    <div key={item.id} className="overflow-hidden rounded border border-border bg-card">
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                                <ExpandButton
                                    expanded={expandedId === item.id}
                                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                />
                                {renderName(item)}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">{renderActions(item)}</div>
                        </div>
                        {expandedId === item.id && renderInfo(item)}
                    </div>
                ))}
                {items.length === 0 && <div className="px-1 py-2 text-text-muted">{empty}</div>}
            </div>
            {footer}
        </div>
    );
};
