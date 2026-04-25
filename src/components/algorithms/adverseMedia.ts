/**
 * Interface for the identified risk event
 */
export interface AdverseEvent {
  company: string;
  headline: string;
  link: string;
  date: string;
  severityScore: number;
  thumbnail?: string;
}

export class AdverseMediaScanner {
  // Public CORS Anywhere demo server
  private readonly PROXY = "https://corsproxy.io/?";
  
  private readonly RED_FLAGS = ['fraud', 'fine', 'investigation', 'arrest', 'sanction', 'indictment', 'lawsuit', 'criminal'];
  private readonly NOISE = ['opinion', 'op-ed', 'editorial'];

  async scan(companyName: string): Promise<AdverseEvent[]> {
    // 1. Precise Query Construction
    const searchQuery = `"${companyName}" (fraud OR fine OR investigation OR arrest)`;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
    
    try {
      // 2. Fetch via CORS Anywhere
      // Note: If you get a 403, visit https://cors-anywhere.herokuapp.com/corsdemo
      const response = await fetch(`${this.PROXY}${rssUrl}`, {
        headers: {
          // This is the most important header for cors-anywhere
          'X-Requested-With': 'XMLHttpRequest',
          // Sometimes required to stop Google from thinking you're a bot
          'Accept': 'application/xml, text/xml, */*'
        }
      });

      if (response.status === 403) {
        throw new Error("CORS Anywhere Access Denied. Visit https://cors-anywhere.herokuapp.com/corsdemo to activate.");
      }

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const xmlString = await response.text();

      // 3. Browser-native Parsing
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");
      const items = Array.from(xmlDoc.querySelectorAll("item"));

      const results: AdverseEvent[] = [];
      const MRSS_NS = "http://search.yahoo.com/mrss/";

      items.forEach(item => {
        const title = item.querySelector("title")?.textContent || "";
        const link = item.querySelector("link")?.textContent || "";
        const pubDate = item.querySelector("pubDate")?.textContent || "";
        const description = item.querySelector("description")?.textContent || "";
        const content = title.toLowerCase();

        // Improved thumbnail extraction logic
        let thumbnail = "";

        // 1. Try to find media tags with various methods, including namespace awareness
        const getMediaUrl = (el: Element) => {
          // Try media:content and media:thumbnail
          const mediaTags = ["content", "thumbnail"];
          for (const tag of mediaTags) {
            const nodes = el.getElementsByTagNameNS ? el.getElementsByTagNameNS(MRSS_NS, tag) : [];
            if (nodes.length > 0) return nodes[0].getAttribute("url");
            
            const prefNodes = el.getElementsByTagName(`media:${tag}`);
            if (prefNodes.length > 0) return prefNodes[0].getAttribute("url");

            const localNodes = el.getElementsByTagName(tag);
            if (localNodes.length > 0) return localNodes[0].getAttribute("url");
          }
          return null;
        };

        thumbnail = getMediaUrl(item) || "";

        // 2. Check for enclosure
        if (!thumbnail) {
          const enclosure = item.querySelector("enclosure");
          if (enclosure && (enclosure.getAttribute("type")?.startsWith("image/") || enclosure.getAttribute("url")?.match(/\.(jpg|jpeg|png|gif|webp)/i))) {
            thumbnail = enclosure.getAttribute("url") || "";
          }
        }

        // 3. Robust regex/DOM parsing on description for <img> tags
        if (!thumbnail && description) {
          // Google News RSS description is often HTML-encoded
          const doc = parser.parseFromString(description, "text/html");
          const img = doc.querySelector("img");
          if (img) {
            thumbnail = img.getAttribute("src") || "";
          }
          
          if (!thumbnail) {
            // Fallback to regex if DOMParser didn't find it (sometimes it's just raw text)
            const imgMatch = description.match(/<img[^>]+src=["']?([^"'>\s]+)["']?[^>]*>/i);
            if (imgMatch) {
              thumbnail = imgMatch[1];
            }
          }
          
          if (thumbnail && thumbnail.startsWith("//")) {
            thumbnail = "https:" + thumbnail;
          }
        }

        // 4. Noise Filter (Exclude Op-Eds)
        if (this.NOISE.some(word => content.includes(word))) return;

        // 5. Weighting Logic
        let score = 0;
        this.RED_FLAGS.forEach(flag => {
          if (content.includes(flag)) score += 25;
        });

        if (score >= 25) {
          results.push({
            company: companyName,
            headline: title,
            link: link,
            date: pubDate,
            severityScore: Math.min(score, 100),
            thumbnail: thumbnail
          });
        }
      });

      return results.sort((a, b) => b.severityScore - a.severityScore);
    } catch (error) {
      console.error("Adverse Media Scraper Error:", error);
      return [];
    }
  }

  calculateAdverseScore(flashyNews: AdverseEvent[]): number {
    let adverseScore = 0;
    flashyNews.forEach(article => {
        adverseScore += article.severityScore;
    });
    return adverseScore;
  }
}

// Example Usage:
//const scanner = new AdverseMediaScanner();
//scanner.scan('Tesla').then(console.log);