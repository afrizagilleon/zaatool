
import { SchemaField } from "@zaa-tool/shared";

export function inferSchema(value: unknown, name = "output"): SchemaField {
    if (value === null || value === undefined)
        return { name, type: "any" };
    if (typeof value === "string") return { name, type: "string" };
    if (typeof value === "number") return { name, type: "number" };
    if (typeof value === "boolean") return { name, type: "boolean" };

    if (Array.isArray(value)) {
        if (value.length === 0)
            return { name, type: "array", items: { name: "item", type: "any" } };

        const merged = value.reduce((acc, el) => {
            if (el && typeof el === "object" && !Array.isArray(el)) {
                Object.assign(acc, el);
            }
            return acc;
        }, {} as Record<string, unknown>);

        const sample = typeof merged === "object" && Object.keys(merged).length > 0
            ? merged
            : value[0];

        return {
            name,
            type: "array",
            items: inferSchema(sample, "item")
        };
    }

    if (typeof value === "object") {
        return {
            name,
            type: "object",
            fields: Object.entries(value as Record<string, unknown>)
                .map(([k, v]) => inferSchema(v, k))
        };
    }

    return { name, type: "any" };
}