import { OwnedTab } from "../browser/owned-tab.js";
import { bet365Publication, bet365DetailPublication } from "../publication.js";
import { queue, flush } from "../publisher.js";
import {
  codes,
  type Capture,
  type Esport,
} from "../../../odds-service/src/modules/bet365/types/model.js";
import { parseCapture } from "../../../odds-service/src/modules/bet365/parsers/list.parser.js";
import { parseDetail } from "../../../odds-service/src/modules/bet365/parsers/coupon.parser.js";
import {
  eventRoute,
  isReadOnlyTab,
} from "../../../odds-service/src/modules/bet365/persistence/detail-round.js";

const origin = "https://www.bet365.bet.br";
const listPath = "/contentdata/othersportsmatchmarketscontentapi/list";
const esports: Esport[] = ["cs2", "lol", "valorant"];
const warmupExpression = `(()=>{const visible=e=>!!(e.offsetWidth||e.offsetHeight);const consent=[...document.querySelectorAll('button')].find(e=>visible(e)&&e.textContent.trim()==='Somente os essenciais');if(consent){consent.click();return false}const es=[...document.querySelectorAll('a,button,span,div')].filter(e=>visible(e)&&/^e-?sports$/i.test(e.textContent.trim()));const e=es.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];if(!e)return false;e.click();return true})()`;

let tab: OwnedTab | undefined;
let warmed = false;
const listings = new Map<Esport, Capture>();

export function bet365HasListingContext() {
  return esports.every((esport) => listings.has(esport));
}

export async function closeBet365() {
  await tab?.close();
  tab = undefined;
  warmed = false;
  listings.clear();
}

function pageUrl(pd: string) {
  if (!/^#(?:[A-Z][A-Za-z0-9^.-]*#)+$/.test(pd) || pd.includes("#I99#"))
    throw Error("Unadvertised Bet365 navigation");
  return origin + "/#/" + pd.slice(1, -1).split("#").join("/") + "/";
}

function feedCapture(
  esport: Esport,
  response: Awaited<ReturnType<OwnedTab["capture"]>>,
): Capture {
  if (!response.body.startsWith("F|")) throw Error("Incomplete Bet365 feed");
  return {
    provider: "bet365",
    esport,
    capturedAt: response.capturedAt,
    source: {
      transport: "xhr",
      method: "GET",
      url: response.url,
      capture: "chrome-cdp-response",
      authenticated: null,
    },
    body: response.body,
  };
}

async function captureFullFeed(page: OwnedTab, path: string, pd: string) {
  const route = pageUrl(pd);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await page.capture(
        path,
        (url) => url.searchParams.get("pd") === pd,
        () => page.navigate(route),
        25000,
        (body) => body.startsWith("F|"),
      );
    } catch (error) {
      if (
        attempt > 0 ||
        !(error instanceof Error) ||
        !/^Bookmaker full feed unavailable; skipped=\d+, kind=empty, cache=network, otherPd=0$/.test(
          error.message,
        )
      )
        throw error;
    }
  }
  throw Error("Bookmaker full feed unavailable");
}

async function ownTab() {
  if (!tab) {
    tab = await OwnedTab.open("bet365");
    warmed = false;
  }
  if (!warmed) {
    await tab.retryClick(warmupExpression);
    warmed = true;
  }
  return tab;
}

export async function collectBet365() {
  try {
    const reused = Boolean(tab);
    const page = await ownTab();
    if (reused) {
      await page.navigate(origin + "/");
      await page.retryClick(warmupExpression);
    }
    const publications = [];
    for (const esport of esports) {
      const pd = `#AC#B151#C1#D50#E${codes[esport]}#F163#`;
      const response = await captureFullFeed(page, listPath, pd).catch(
        (error: unknown) => {
          const message = error instanceof Error ? error.message : "Error";
          throw Error(`Bet365 ${esport}: ${message}`);
        },
      );
      const capture = feedCapture(esport, response);
      publications.push(bet365Publication(capture));
      listings.set(esport, capture);
    }
    for (const publication of publications) await queue(publication);
    await flush();
    return publications.flatMap((publication) => publication.events);
  } catch (error) {
    await closeBet365();
    throw error;
  }
}

export async function collectBet365Detail(esport: Esport, eventId: string) {
  try {
    const listing = listings.get(esport);
    if (!listing) throw Error("Missing Bet365 listing context");
    const parsed = parseCapture(listing);
    const match = parsed.matches.find((event) => event.eventId === eventId);
    if (!match) throw Error("Bet365 event absent from listing");
    const page = await ownTab();
    const path = "/contentdata/othersportsmatchbettingcontentapi/coupon";
    const capture = async (pd: string) => {
      const response = await captureFullFeed(page, path, pd);
      return feedCapture(esport, response);
    };
    const route = eventRoute(listing, eventId);
    const first = await capture(route);
    const detail = parseDetail(first, {
      match,
      inPlay: parsed.provenance[eventId].inPlay,
    });
    const captures = [first];
    for (const tab of detail.tabs.filter(isReadOnlyTab))
      if (tab.pd !== route) captures.push(await capture(tab.pd));
    const publication = bet365DetailPublication({
      eventId,
      listing,
      captures,
      coverage: "all_tabs",
    });
    await queue(publication);
    await flush();
    return publication.events[0].markets.length;
  } catch (error) {
    await closeBet365();
    throw error;
  }
}
