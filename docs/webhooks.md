# 🪝 Webhooks

DPM can report activity events to external services — a chat channel, a push service, an
incident tool, a script of your own. Each webhook sends a **JSON body you write yourself**,
with placeholders for the data of the event that triggered it.

Webhooks are managed on the **Webhooks** page in the sidebar, under System. The API is described under
[Webhooks in the API reference](api.md#-webhooks).

*The editor shows target, filters and headers above, and the body template beside its preview, rendered against a sample event.*

## When a webhook fires

Every event the server stores for the first time goes to every enabled webhook whose
filters it passes:

- **Minimum level** — `trace`, `info`, `warning` or `error`. The default is `warning`.
- **Event kinds** — a comma-separated list of patterns, `*` as wildcard: `record.*`,
  `scheduler.failed`. Empty means every kind. The kinds are listed in the
  [Activity reference](api.md#-activity).

## Delivery

- `POST` (or `PUT`) with `Content-Type: application/json` and the headers you configured.
- Per attempt the configured timeout applies (default 10 s). When nothing answers, or the
  target answers 5xx or 429, the delivery is tried twice more, after 1 s and 5 s.
- Events are sent to one target in the order they arrived.
- The outcome of the last delivery is shown in the list. A failure is logged, but **does not
  create an activity event** — a broken target would otherwise report its own failures to
  itself.
- There is no persistent queue. A server restart during a retry loses that delivery; the
  event itself stays in the activity list.

## Templates

A template is **valid JSON** with `{{…}}` placeholders in its strings. It is filled in on the
parsed JSON, never as text, so a quote or a brace in an event's data cannot break the body.

| Written as | Becomes |
| :--------- | :------ |
| `"{{event.data}}"` — a string that is only one placeholder | The value **with its type**: an object stays an object, a number a number, a missing value `null`. |
| `"Job {{event.data.scheduler}} failed"` — a placeholder inside text | Text. A missing value is empty, an object is written as JSON. |
| `{{event.detail \| default("none")}}` | The fallback when the value is missing, `null` or empty. The fallback is a JSON value (`"text"`, `0`, `null`) or text in single quotes (`'text'`). More [filters](#filters) below. |
| `{ "{{event.kind}}": … }` | Placeholders work in keys too, as text. |

Placeholders also work in the **URL** and in **header values**, always as text.

A path must start with `event` or `webhook`; anything else is refused when the webhook is
saved, as is a template that is not valid JSON or longer than 64 KiB. The editor page shows a
live preview rendered with a sample event, and **Send Test** delivers that sample to the
target. The sample follows the webhook's event kinds: the first sample one of them matches,
the first sample when none does.

### What a template can read

| Placeholder | Content |
| :---------- | :------ |
| `event.message` | The sentence the dashboard shows, e.g. `Activity cleanup failed: database is locked` |
| `event.detail` | The dashboard's second line, such as an error; `null` if none |
| `event.kind` | `record.changed`, `provider.created`, `scheduler.failed`, … |
| `event.level` | `trace`, `info`, `warning` or `error` |
| `event.occurredAt` | When it happened (ISO 8601) |
| `event.receivedAt` | When the server stored it |
| `event.source` | `user` for a change someone made, `server` for what the server did |
| `event.id` | Unique id of the event |
| `event.correlationId` | Groups events that belong together; mostly `null` |
| `event.subject` | What the event is about: `recordId`, `siteId` or `providerId` |
| `event.data` | The facts of the kind, e.g. `{ user, name, type, value, sites, changes }`; single fields as `event.data.name` |
| `webhook.name` | The webhook's own name |

Which fields `event.data` carries per kind is listed in the
[Activity reference](api.md#-activity). An array element is reached by its position:
`event.data.items.0.name`.

### Filters

Filters follow the path, separated by `|`, and run left to right. They work everywhere a
placeholder does, URL and headers included.

| Filter | Does |
| :----- | :--- |
| `default(<value>)` | The value when the one before is missing, `null` or empty |
| `join(", ")` | An array as text, its items separated by the given text (`", "` when left out). Objects in it are written as JSON. |
| `map("name")` | From an array of objects, the one field of each: `[{name: "app.example.com"}, …]` → `["app.example.com", …]` |
| `upper`, `lower` | Text in upper or lower case |
| `truncate(12)` | The first characters of a text, cut without an ellipsis. The number is required and at least 1. |

```text
{{event.data.names | join(", ")}}                   → app.example.com, db.example.com
{{event.data.records | map("name") | join(", ")}}   → app.example.com, db.example.com
{{event.level | upper}}                             → ERROR
{{event.id | truncate(8)}}                          → 3f2a9c1e
```

A filter handed a value it cannot work on — `join` on a number, `upper` on an object — passes
it on unchanged. An unknown filter is refused when the webhook is saved, as is a `truncate`
without a whole number.

### Conditions and loops

For what a single placeholder cannot say — a line only when there is an error, one line per
item — a template uses **directives**: JSON objects with a key starting with `$`.
They borrow their names from [JSON-e](https://json-e.js.org/), and like everything else they
work on the parsed JSON, so they cannot break it either.

**`$if`** — takes `then` when the condition holds, else `else`:

```json
{
    "reason": { "$if": "event.detail", "then": "because: {{event.detail}}", "else": "no reason given" }
}
```

A branch that is left out drops what the directive stands for: the key in an object, the
item in an array (`null` for a whole template). The condition is one of

| Condition | Holds when |
| :-------- | :--------- |
| `path` | the value is there and not `null`, `""`, `false`, `0` or an empty array |
| `!path` | it is not |
| `path == 'error'`, `path != 'error'` | the value is, or is not, equal to the one given — as a JSON value (`"error"`, `51`, `true`, `null`) or text in single quotes. `51` and `'51'` are not equal. |

There is nothing beyond these: no `and`, no `or`, no arithmetic. Two conditions are two
nested `$if`s.

**`$map`** — one item per element of an array, rendered with `each(name)`, in which `name`
is the element; `each(name, index)` adds its position, counted from 0:

```json
{
    "names": { "$map": "event.data.records", "each(r)": { "name": "{{r.name}}", "type": "{{r.type}}" } }
}
```

The path names the array without braces (`"{{event.data.records}}"` is accepted too) and
may carry filters. Anything but an array gives `[]`. Loops nest, and an inner one can read the
outer one's name. A name may not be `event`, `webhook` or one already in use.

**`$join`** — renders what it holds and joins the resulting array into text, separated by
`with` (nothing when left out). That is how a loop becomes a message:

```json
{
    "content": {
        "$join": {
            "$map": "event.data.records",
            "each(r)": {
                "$if": "r.error",
                "then": "- {{r.name}}: {{r.error}}",
                "else": "- {{r.name}}: ok"
            }
        },
        "with": "\n"
    }
}
```

→ `"- app.example.com: ok\n- db.example.com: zone not found"`

- An object holding a directive may hold only that directive's own keys (`then`/`else`,
  `each(…)`, `with`); two directives in one object are refused.
- Directives nest at most 8 deep. A loop only ever runs over an array the event carries,
  so a template always finishes.
- A key that has to reach the target starting with `$if`, `$map` or `$join` is written with a
  second `$`: `"$$if"` is sent as `"$if"`. Other `$` keys, such as `$schema`, are sent as
  written.

## Examples

### A chat message (Slack, Mattermost, Rocket.Chat)

```json
{
    "text": "[{{event.level | upper}}] {{event.message}}"
}
```

### Gotify

URL `https://gotify.example.com/message`, header `X-Gotify-Key: <application token>`:

```json
{
    "title": "DPM: {{event.kind}}",
    "message": "{{event.message}}",
    "priority": { "$if": "event.level == 'error'", "then": 8, "else": 5 }
}
```

## Security

- Header values — typically a token — are stored **in the clear** in the server database and
  shown in the editor to every user who can log in. Everyone with a login can manage
  webhooks, just as they can manage everything else.
- The server makes the requests, so it can reach whatever the server can reach, internal
  addresses included. That is intended for targets on the internal network; keep it in mind
  when handing out logins.
- The log names a failing webhook and the reason, never its headers.
