import { OwnedTab } from "../browser/owned-tab.js";
import { betanoPublication, betanoDetailPublication } from "../publication.js";
import { queue, flush } from "../publisher.js";
import {
  regions,
  safeUrl,
  type BetanoCapture,
} from "../../../odds-service/src/modules/betano/parsers/feed.parser.js";
import type { Esport } from "../../../odds-service/src/shared/types/common.js";
import type { NormalizedEvent } from "../../../odds-service/src/shared/domain/normalized-event.js";

const origin = "https://www.betano.bet.br";
const esports: Esport[] = ["cs2", "lol", "valorant"];
let tab: OwnedTab | undefined;
const contexts = new Map<
  Esport,
  {
    region: string;
    leagues: Array<{ id: string; name: string }>;
    events: NormalizedEvent[];
  }
>();

export function betanoHasListingContext() {
  return esports.every((esport) => contexts.has(esport));
}

export async function closeBetano() {
  await tab?.close();
  tab = undefined;
  contexts.clear();
}

async function ownTab() {
  if (!tab) tab = await OwnedTab.open("betano");
  await tab.retryClick(
    `(()=>{const age=document.querySelector('[data-qa="age-verification-modal-ok-button"]');if(age&&document.body?.innerText.includes('VOCÊ TEM MAIS DE 18 ANOS?')){age.click();return false}return !!document.querySelector('a[href="/sport/esports/"]')})()`,
  );
  return tab;
}

async function clickLink(
  page: OwnedTab,
  path: string,
  advertisedDetail = false,
) {
  if (
    path !== "/sport/esports/" &&
    !/^\/sport\/esports\/competicoes\/(counter-strike|league-of-legends|valorant)\/\d+\/$/.test(
      path,
    ) &&
    !(advertisedDetail && /^\/odds\/[a-z0-9-]+\/\d+\/$/.test(path))
  )
    throw Error("Unadvertised Betano navigation");
  await page.retryClick(
    `(()=>{const a=[...document.querySelectorAll('a[href]')].find(a=>a.getAttribute('href')===${JSON.stringify(path)});if(!a)return false;a.click();return true})()`,
  );
}

async function clickText(page: OwnedTab, name: string) {
  if (!name || name.length > 200) throw Error("Invalid Betano competition");
  await page.retryClick(
    `(()=>{const e=[...document.querySelectorAll('a,button,span,div')].find(e=>e.children.length===0&&e.textContent?.trim()===${JSON.stringify(name)}&&!e.closest('.selections__selection,[aria-label^="Bet on"]'));if(!e)return false;e.click();return true})()`,
  );
}

async function capture(
  page: OwnedTab,
  pathname: string,
  accept: (url: URL) => boolean,
  action: () => Promise<void>,
): Promise<BetanoCapture> {
  const response = await page.capture(pathname, accept, action);
  const body = JSON.parse(response.body);
  if (!body?.data || typeof body.data !== "object")
    throw Error("Missing Betano structured data");
  const data = { ...body.data };
  delete data.seoComponent;
  delete data.seoTranslations;
  return {
    provider: "betano",
    capturedAt: response.capturedAt,
    status: response.status,
    source: {
      transport: "xhr",
      method: "GET",
      url: safeUrl(response.url),
      capture: "chrome-cdp-response",
      authenticated: false,
    },
    data,
  };
}

export async function collectBetano() {
  try {
    const page = await ownTab();
    const directory = await capture(
      page,
      "/api/sport/esports/",
      () => true,
      () => clickLink(page, "/sport/esports/"),
    );
    const advertised = directory.data.regionGroups?.flatMap(
      (group: {
        regions: Array<{ id: string; url: string; leagues: unknown[] }>;
      }) => group.regions,
    );
    if (!Array.isArray(advertised))
      throw Error("Missing Betano directory regions");
    const publications = [];
    for (const esport of esports) {
      const region = advertised.find(
        (item: { id: string }) => String(item.id) === regions[esport].id,
      );
      if (!region || !Array.isArray(region.leagues))
        throw Error("Missing Betano sport coverage");
      if (
        !/^\/sport\/esports\/competicoes\/(counter-strike|league-of-legends|valorant)\/\d+\/$/.test(
          region.url,
        )
      )
        throw Error("Invalid Betano region route");
      const pathname = "/api" + region.url;
      const first = await capture(
        page,
        pathname,
        (url) => !url.searchParams.has("sl"),
        () => clickLink(page, region.url),
      );
      const leagues = first.data.selectedLeagues;
      if (!Array.isArray(leagues) || !leagues.length)
        throw Error("Betano competition coverage unavailable");
      const captures = [first];
      for (const league of leagues) {
        if (
          first.data.blocks?.some(
            (block: { id: string }) => String(block.id) === String(league.id),
          )
        )
          continue;
        captures.push(
          await capture(
            page,
            pathname,
            (url) => url.searchParams.get("sl") === String(league.id),
            () => clickText(page, league.name),
          ),
        );
      }
      const publication = betanoPublication({
        kind: "listing",
        esport,
        directory,
        regionId: String(region.id),
        expectedLeagues: leagues.map((league: { id: string }) =>
          String(league.id),
        ),
        captures,
      });
      contexts.set(esport, {
        region: region.url,
        leagues: leagues.map((league: { id: string; name: string }) => ({
          id: String(league.id),
          name: league.name,
        })),
        events: publication.events,
      });
      publications.push(publication);
      await clickLink(page, "/sport/esports/");
    }
    for (const publication of publications) await queue(publication);
    await flush();
    return publications.flatMap((publication) => publication.events);
  } catch (error) {
    await closeBetano();
    throw error;
  }
}

export async function collectBetanoDetail(esport: Esport, eventId: string) {
  try {
    const context = contexts.get(esport);
    if (!context) throw Error("Missing Betano listing context");
    const event = context.events.find((item) => item.eventId === eventId);
    if (!event) throw Error("Betano event absent from listing");
    const leagueId = String(event.provenance.leagueId);
    const league = context.leagues.find((item) => item.id === leagueId);
    if (!league) throw Error("Betano league absent from listing");
    const detailPath = String(event.provenance.url);
    const page = await ownTab();
    await clickLink(page, context.region);
    await clickText(page, league.name);
    const detail = await capture(
      page,
      "/api" + detailPath,
      () => true,
      () => clickLink(page, detailPath, true),
    );
    const publication = betanoDetailPublication(detail, esport, eventId);
    await queue(publication);
    await flush();
    await clickLink(page, "/sport/esports/");
    return publication.events[0].markets.length;
  } catch (error) {
    await closeBetano();
    throw error;
  }
}
