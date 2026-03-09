"""
Scrapling Service — Jarvis Data Ingestion Layer

Standalone FastAPI service that wraps Scrapling for:
- Price scraping from DEX aggregators
- Social sentiment monitoring (X, Reddit, Discord)
- Competitor intelligence (DeFi protocols)
- Arbitrary page scraping with adaptive selectors
- Screenshot capture for vision analysis

Called by Jarvis bot via HTTP. Runs as separate process or Fly.io service.
"""

import asyncio
import json
import re
import os
from typing import Optional
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

app = FastAPI(title="Jarvis Scraper", version="1.0.0")

# Auth
API_SECRET = os.environ.get("SCRAPER_API_SECRET", "")

def check_auth(x_api_secret: Optional[str] = Header(None)):
    if API_SECRET and x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ============ Models ============

class ScrapeRequest(BaseModel):
    url: str
    selectors: Optional[dict] = None  # {"name": "css_selector", ...}
    adaptive: bool = False
    stealth: bool = False
    dynamic: bool = False
    screenshot: bool = False
    timeout: int = 15
    extract_text: bool = True
    extract_links: bool = False
    max_text_length: int = 5000

class SpiderRequest(BaseModel):
    start_urls: list[str]
    selectors: dict  # {"field_name": "css_selector", ...}
    follow_selector: Optional[str] = None  # CSS selector for pagination links
    max_pages: int = 10
    stealth: bool = False
    concurrent: int = 3

class MultiScrapeRequest(BaseModel):
    urls: list[str]
    selectors: Optional[dict] = None
    stealth: bool = False
    extract_text: bool = True
    max_text_length: int = 3000


# ============ Core Scraping ============

@app.post("/scrape")
async def scrape_page(req: ScrapeRequest, x_api_secret: Optional[str] = Header(None)):
    """Scrape a single page with optional selectors, stealth, and adaptive mode."""
    check_auth(x_api_secret)

    try:
        if req.dynamic:
            from scrapling.fetchers import DynamicFetcher
            page = DynamicFetcher.fetch(
                req.url,
                headless=True,
                timeout=req.timeout * 1000,
                network_idle=True
            )
        elif req.stealth:
            from scrapling.fetchers import StealthyFetcher
            if req.adaptive:
                StealthyFetcher.adaptive = True
            page = StealthyFetcher.fetch(
                req.url,
                headless=True,
                timeout=req.timeout * 1000
            )
        else:
            from scrapling.fetchers import Fetcher
            page = Fetcher.get(
                req.url,
                stealthy_headers=True,
                timeout=req.timeout
            )

        result = {"url": req.url, "status": "ok"}

        # Extract with selectors
        if req.selectors:
            data = {}
            for name, selector in req.selectors.items():
                if selector.startswith("//"):
                    # XPath
                    elements = page.xpath(selector)
                else:
                    # CSS
                    elements = page.css(selector, adaptive=req.adaptive)

                if elements:
                    texts = [el.text.strip() for el in elements if el.text and el.text.strip()]
                    data[name] = texts if len(texts) > 1 else (texts[0] if texts else None)
                else:
                    data[name] = None
            result["data"] = data

        # Extract full text
        if req.extract_text:
            body_text = page.css("body").get()
            if body_text:
                # Clean text
                text = body_text.text or ""
                text = re.sub(r'\s+', ' ', text).strip()
                result["text"] = text[:req.max_text_length]

        # Extract links
        if req.extract_links:
            links = []
            for a in page.css("a[href]"):
                href = a.attrib.get("href", "")
                link_text = (a.text or "").strip()
                if href and not href.startswith(("#", "javascript:")):
                    links.append({"href": href, "text": link_text})
            result["links"] = links[:100]

        # Screenshot
        if req.screenshot and (req.dynamic or req.stealth):
            # Only available with browser-based fetchers
            try:
                screenshot_data = page.screenshot()
                if screenshot_data:
                    import base64
                    result["screenshot_base64"] = base64.b64encode(screenshot_data).decode()
            except Exception:
                result["screenshot_base64"] = None

        return JSONResponse(result)

    except Exception as e:
        return JSONResponse({"url": req.url, "status": "error", "error": str(e)[:500]}, status_code=500)


@app.post("/scrape/multi")
async def scrape_multiple(req: MultiScrapeRequest, x_api_secret: Optional[str] = Header(None)):
    """Scrape multiple URLs concurrently."""
    check_auth(x_api_secret)

    from scrapling.fetchers import Fetcher, StealthyFetcher

    results = []
    for url in req.urls[:20]:  # Cap at 20
        try:
            if req.stealth:
                page = StealthyFetcher.fetch(url, headless=True)
            else:
                page = Fetcher.get(url, stealthy_headers=True, timeout=10)

            item = {"url": url, "status": "ok"}

            if req.selectors:
                data = {}
                for name, selector in req.selectors.items():
                    elements = page.css(selector) if not selector.startswith("//") else page.xpath(selector)
                    if elements:
                        texts = [el.text.strip() for el in elements if el.text and el.text.strip()]
                        data[name] = texts if len(texts) > 1 else (texts[0] if texts else None)
                    else:
                        data[name] = None
                item["data"] = data

            if req.extract_text:
                body = page.css("body").get()
                if body:
                    text = re.sub(r'\s+', ' ', body.text or "").strip()
                    item["text"] = text[:req.max_text_length]

            results.append(item)

        except Exception as e:
            results.append({"url": url, "status": "error", "error": str(e)[:200]})

    return JSONResponse({"results": results})


# ============ Specialized Scrapers ============

@app.get("/prices/{token}")
async def scrape_prices(token: str, x_api_secret: Optional[str] = Header(None)):
    """Scrape token prices from multiple DEX aggregators as backup to API feeds."""
    check_auth(x_api_secret)

    from scrapling.fetchers import Fetcher

    sources = {
        "dexscreener": f"https://dexscreener.com/search?q={token}",
        "coingecko": f"https://www.coingecko.com/en/coins/{token}",
    }

    prices = {}
    for source, url in sources.items():
        try:
            page = Fetcher.get(url, stealthy_headers=True, timeout=10)

            if source == "coingecko":
                price_el = page.css('[data-converter-target="price"]')
                if price_el:
                    prices[source] = price_el[0].text.strip()

            elif source == "dexscreener":
                # DexScreener needs JS — just grab what static HTML has
                price_el = page.css('.chakra-text[data-testid]')
                if price_el:
                    prices[source] = price_el[0].text.strip()

        except Exception as e:
            prices[source] = f"error: {str(e)[:100]}"

    return JSONResponse({"token": token, "prices": prices})


@app.get("/sentiment/{query}")
async def scrape_sentiment(query: str, x_api_secret: Optional[str] = Header(None)):
    """Scrape social sentiment for a query from Reddit and HN."""
    check_auth(x_api_secret)

    from scrapling.fetchers import Fetcher

    results = {"query": query, "sources": {}}

    # Reddit
    try:
        page = Fetcher.get(
            f"https://old.reddit.com/search/?q={query}&sort=new&t=week",
            stealthy_headers=True,
            timeout=10
        )
        posts = []
        for post in page.css(".search-result")[:10]:
            title = post.css(".search-title")
            if title:
                posts.append({
                    "title": title[0].text.strip(),
                    "subreddit": (post.css(".search-subreddit-link") or [None])[0].text.strip() if post.css(".search-subreddit-link") else None,
                })
        results["sources"]["reddit"] = posts
    except Exception as e:
        results["sources"]["reddit"] = f"error: {str(e)[:100]}"

    # Hacker News (Algolia search)
    try:
        page = Fetcher.get(
            f"https://hn.algolia.com/?dateRange=pastWeek&page=0&prefix=true&query={query}&sort=byDate&type=story",
            stealthy_headers=True,
            timeout=10
        )
        stories = []
        for story in page.css(".Story")[:10]:
            title = story.css(".Story_title a")
            if title:
                stories.append({"title": title[0].text.strip()})
        results["sources"]["hackernews"] = stories
    except Exception as e:
        results["sources"]["hackernews"] = f"error: {str(e)[:100]}"

    return JSONResponse(results)


# ============ Health ============

@app.get("/health")
async def health():
    return {"status": "ok", "service": "jarvis-scraper"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8900))
    uvicorn.run(app, host="0.0.0.0", port=port)
