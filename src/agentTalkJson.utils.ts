// a json object from the wire: not null and not a list
export const getIsJsonObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// a step is a handful of levels deep. json that came from someone else can nest thousands deep, which would
// overflow the stack
const NESTING_MAX = 64;

const getCanonicalValue = (value: unknown, depth: number): string => {
    if (depth > NESTING_MAX) {
        throw new TypeError("canonical json cannot nest this deep");
    }

    if (value === null || typeof value === "boolean" || typeof value === "string") {
        return JSON.stringify(value);
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("canonical json cannot hold a non-finite number");
        }
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => getCanonicalValue(item === undefined ? null : item, depth + 1)).join(",")}]`;
    }

    if (typeof value === "object") {
        const entries = Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

        return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${getCanonicalValue(entryValue, depth + 1)}`).join(",")}}`;
    }

    throw new TypeError(`canonical json cannot hold a ${typeof value}`);
};

// rfc 8785 (jcs): object keys sorted by utf-16 code units, no whitespace, numbers in their shortest
// es form. json.stringify already prints numbers and escapes strings the way jcs wants
export const getCanonicalJson = (value: unknown): string => getCanonicalValue(value, 0);
