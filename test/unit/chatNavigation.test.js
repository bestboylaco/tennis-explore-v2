import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const indexHtml = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const platformsHtml = await readFile(new URL("../../public/platforms.html", import.meta.url), "utf8");

describe("AI Coach navigation", () => {
    it("uses the confirmed organisational tool destinations in the left sidebar", () => {
        const destinations = [
            "https://tennis.smartabase.com/ams/auth",
            "https://app-v3.teambuildr.com/login",
            "https://login.teamworksapp.com/",
            "https://www.tennismove.com.au/",
        ];

        for (const destination of destinations) {
            assert.match(indexHtml, new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        }
    });

    it("opens organisational tools separately so the AI Coach workspace stays mounted", () => {
        const externalLinks = indexHtml.match(/class="navigation__item navigation__item--external"[\s\S]*?<\/a>/g) ?? [];

        assert.equal(externalLinks.length, 4);

        for (const link of externalLinks) {
            assert.match(link, /target="_blank"/);
            assert.match(link, /rel="noopener noreferrer"/);
        }
    });

    it("removes Platforms and About from the AI Coach top bar without deleting the Platforms page", () => {
        assert.doesNotMatch(indexHtml, /class="chat-topbar__links"/);
        assert.match(platformsHtml, /Platforms|integrated platforms/i);
    });
});
