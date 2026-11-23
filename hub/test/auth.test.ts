import { describe, expect, it } from "vitest";
import { RateLimiter, parseCookies, safeEqual } from "../src/server/auth.js";

describe("auth", () => {
  it("compara tokens en tiempo constante", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
  });

  it("parsea cookies", () => {
    expect(parseCookies("a=1; ffbeast_token=xyz; b=2")).toEqual({
      a: "1",
      ffbeast_token: "xyz",
      b: "2",
    });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("RateLimiter", () => {
  it("permite la ráfaga y luego bloquea", () => {
    const limiter = new RateLimiter(20, 40);
    for (let i = 0; i < 40; i += 1) {
      expect(limiter.allow("ip")).toBe(true);
    }
    expect(limiter.allow("ip")).toBe(false);
    expect(limiter.allow("otra-ip")).toBe(true);
  });
});
