# API reference

## `load(options?)`

Reads and merges configuration.

**Parameters**

- `options` *(object, optional)*
  - `path` *(string)* — file to read. Default: `"config.json"`.
  - `env` *(boolean)* — read environment variables. Default: `true`.

**Returns** `Promise<Settings>`

**Throws** `ConfigError` when the file is not valid JSON.

### Example

```ts
const s = await load({ path: "app.json", env: false });
```

---

## `Settings`

| Field | Type | Notes |
|-------|------|-------|
| `port` | `number` | 1–65535 |
| `host` | `string` | Hostname or IP |
| `tls` | `TlsOptions \| null` | `null` disables TLS |

> **Note:** fields not listed here are passed through unchanged.
