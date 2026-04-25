/**
 * Interface for the identified risk event
 */
interface AdverseEvent {
  company: string;
  headline: string;
  link: string;
  date: string;
  severityScore: number;
}

export default class AdverseMediaScanner {
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

      items.forEach(item => {
        const title = item.querySelector("title")?.textContent || "";
        const link = item.querySelector("link")?.textContent || "";
        const pubDate = item.querySelector("pubDate")?.textContent || "";
        const content = title.toLowerCase();

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
            severityScore: Math.min(score, 100)
          });
        }
      });

      return results.sort((a, b) => b.severityScore - a.severityScore);
    } catch (error) {
      console.error("Adverse Media Scraper Error:", error);
      return [];
    }
  }
}

// Example Usage:
//const scanner = new AdverseMediaScanner();
//scanner.scan('Tesla').then(console.log);