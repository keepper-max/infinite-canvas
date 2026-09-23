import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { customAlphabet, nanoid } from "nanoid";

const randomHex = customAlphabet("0123456789abcdef", 32);

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Generate a unique id.
 *
 * Avoid `crypto.randomUUID`, which is only exposed in secure contexts (HTTPS or
 * localhost) — over plain HTTP it is undefined and throws. `nanoid` works in any
 * context.
 */
export function randomId(): string {
    return nanoid();
}

/** Generate an RFC 4122 UUID v4 without relying on secure-context-only crypto.randomUUID. */
export function randomUuid(): string {
    const value = randomHex();
    const variant = "89ab"[Number.parseInt(value[16], 16) % 4];
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-${variant}${value.slice(17, 20)}-${value.slice(20)}`;
}
