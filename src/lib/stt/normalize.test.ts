import { describe, expect, it } from "vitest";
import { normalizeSpoken } from "./normalize";

describe("normalizeSpoken", () => {
  it("lowercases an engine that writes only capitals, and leaves mixed case alone", () => {
    expect(normalizeSpoken("PAY MY WATER BILL")).toBe("pay my water bill");
    expect(normalizeSpoken("Send $50 to Sam.")).toBe("Send $50 to Sam.");
  });

  it.each([
    ["send fifty dollars to sam", "send 50 dollars to sam"],
    ["pay two hundred and fifty dollars", "pay 250 dollars"],
    ["pay two hundred fifty dollars", "pay 250 dollars"],
    ["forty eight dollars from savings", "48 dollars from savings"],
    ["transfer five hundred dollars", "transfer 500 dollars"],
    ["dispute one thousand two hundred ninety nine dollars", "dispute 1299 dollars"],
    ["i want to save two grand", "i want to save 2 grand"],
    ["move two thousand five hundred", "move 2500"],
    ["send nineteen dollars", "send 19 dollars"],
  ])("writes spoken amounts as digits: %s", (spoken, written) => {
    expect(normalizeSpoken(spoken)).toBe(written);
  });

  it("reads dollars-and-cents said without the words", () => {
    expect(normalizeSpoken("charged me eleven ninety nine but my plan is nine ninety nine")).toBe(
      "charged me 11.99 but my plan is 9.99",
    );
    expect(normalizeSpoken("it was nine fifty")).toBe("it was 9.50");
  });

  it("leaves a pronoun 'one' and ordinary words alone", () => {
    expect(normalizeSpoken("i want one of my accounts")).toBe("i want one of my accounts");
    expect(normalizeSpoken("this is my first account")).toBe("this is my first account");
    expect(normalizeSpoken("one")).toBe("one");
    expect(normalizeSpoken("send me one dollar")).toBe("send me 1 dollar");
    expect(normalizeSpoken("best five")).toBe("best five");
  });

  it("joins digit-by-digit numbers: account numbers plainly, ten digits as a phone number", () => {
    expect(normalizeSpoken("account number two zero one nine four four five five")).toBe("account number 20194455");
    expect(normalizeSpoken("my number is four one six five five five zero one nine nine")).toBe("my number is 416-555-0199");
    expect(normalizeSpoken("room two three four")).toBe("room two three four"); // too short to be one number
  });

  it("writes emails with symbols", () => {
    expect(normalizeSpoken("update my email to alex at acme dot com")).toBe("update my email to alex@acme.com");
    expect(normalizeSpoken("add priya dot k at example dot com please")).toBe("add priya.k@example.com please");
    expect(normalizeSpoken("jo underscore smith at mail dot example dot ca")).toBe("jo_smith@mail.example.ca");
    // "at" in ordinary speech is not an email
    expect(normalizeSpoken("meet me at noon")).toBe("meet me at noon");
  });

  it("writes dates next to a month, and only there", () => {
    expect(normalizeSpoken("on march fourth")).toBe("on march 4th");
    expect(normalizeSpoken("the twenty second of november")).toBe("the 22nd of november");
    expect(normalizeSpoken("march thirty first")).toBe("march 31st");
    expect(normalizeSpoken("second thoughts about the first")).toBe("second thoughts about the first");
  });

  it("cleans real streaming-engine output from the benchmark", () => {
    expect(normalizeSpoken("PAY TWO HUNDRED AND FIFTY DOLLARS TOWARD MY MASTER CARD FROM CHECKING")).toBe(
      "pay 250 dollars toward my master card from checking",
    );
    expect(normalizeSpoken("ADD MY GIM MEMBERSHIP GOOD LIE FITNESS ACCOUNT NUMBER TWO ZERO ONE NINE FOUR FOUR FIVE FIVE")).toBe(
      "add my gim membership good lie fitness account number 20194455",
    );
    expect(normalizeSpoken("DISPUTE ONE THOUSAND TWO HUNDRED NINETY NINE DOLLARS FROM BEST FIVE ON MARCH FOURTH")).toBe(
      "dispute 1299 dollars from best five on march 4th",
    );
    expect(normalizeSpoken("SEND MON TWO HUNDRED BUCKS ON FRIDAY")).toBe("send mon 200 bucks on friday");
    expect(normalizeSpoken("ACMEE CORP CHARGED BE ELEVEN NINETY NINE BUT MY PLAN IS NINE NINETY NINE")).toBe(
      "acmee corp charged be 11.99 but my plan is 9.99",
    );
  });

  it("reads hundreds above nine and years after a date", () => {
    expect(normalizeSpoken("pay eleven hundred dollars")).toBe("pay 1100 dollars");
    expect(normalizeSpoken("send twenty five hundred dollars")).toBe("send 2500 dollars");
    expect(normalizeSpoken("dispute it on march fourth twenty twenty six")).toBe("dispute it on march 4th 2026");
    expect(normalizeSpoken("it was nineteen ninety nine dollars")).toBe("it was 19.99 dollars"); // no date, so a price
  });

  it("keeps punctuation an engine already put in an email name", () => {
    expect(normalizeSpoken("ALEX.SMITH at example dot com")).toBe("alex.smith@example.com");
    expect(normalizeSpoken("jo_smith-2 at example dot com")).toBe("jo_smith-2@example.com");
  });

  it("does not read the verb 'may' or the month 'march' in ordinary speech as a date", () => {
    expect(normalizeSpoken("i may second guess it")).toBe("i may second guess it");
    expect(normalizeSpoken("we march first thing")).toBe("we march first thing");
    expect(normalizeSpoken("pay it on may second")).toBe("pay it on may 2nd");
    expect(normalizeSpoken("may second")).toBe("may 2nd");
  });
});
