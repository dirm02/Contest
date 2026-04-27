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
  
  private readonly RED_FLAGS = [
    'fraud', 'fine', 'investigation', 'arrest', 'sanction', 'indictment', 'lawsuit', 'criminal',
    'bribery', 'corruption', 'kickback', 'money laundering', 'bid rigging', 'conflict of interest',
    'RCMP', 'blackmail', 'embezzlement', 'misconduct', 'allegation', 'illegal', 'scandal', 'court',
    'police', 'probe', 'theft', 'guilty', 'felony', 'prison', 'jail'
  ];
  private readonly NOISE = ['opinion', 'op-ed', 'editorial'];

  private cleanCompanyName(name: string): string {
    // Remove common corporate suffixes to broaden search relevance
    return name
      .replace(/\b(INC|LTD|CORP|LLC|CORPORATION|INCORPORATED|LIMITED|PLC|SA|S\.A|CO|COMPANY)\b\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async scan(companyName: string): Promise<AdverseEvent[]> {
    const cleanedName = this.cleanCompanyName(companyName);
    // 1. Broaden Query: Search for the company and common news terms
    // Using a broader set of keywords to ensure we capture the volume
    const searchQuery = `"${cleanedName}" news`;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
    
    try {
      const response = await fetch(`${this.PROXY}${rssUrl}`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/xml, text/xml, */*'
        }
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const xmlString = await response.text();
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
        const content = (title + " " + description).toLowerCase();

        // Improved thumbnail extraction logic
        let thumbnail = "";
        const getMediaUrl = (el: Element) => {
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

        if (!thumbnail) {
          const enclosure = item.querySelector("enclosure");
          if (enclosure && (enclosure.getAttribute("type")?.startsWith("image/") || enclosure.getAttribute("url")?.match(/\.(jpg|jpeg|png|gif|webp)/i))) {
            thumbnail = enclosure.getAttribute("url") || "";
          }
        }

        if (!thumbnail && description) {
          const doc = parser.parseFromString(description, "text/html");
          const img = doc.querySelector("img");
          if (img) thumbnail = img.getAttribute("src") || "";
          
          if (!thumbnail) {
            const imgMatch = description.match(/<img[^>]+src=["']?([^"'>\s]+)["']?[^>]*>/i);
            if (imgMatch) thumbnail = imgMatch[1];
          }
          
          if (thumbnail && thumbnail.startsWith("//")) thumbnail = "https:" + thumbnail;
        }

        // 4. Noise Filter
        if (this.NOISE.some(word => content.includes(word))) return;

        // 5. Weighting Logic - Count articles but score by risk terms
        let score = 0;
        this.RED_FLAGS.forEach(flag => {
          if (content.includes(flag.toLowerCase())) score += 20;
        });

        // Add to results if it's relevant to the entity
        // We lower the threshold to 0 if the title explicitly mentions the company,
        // or keep a minimum score of 1 to ensure it's "adverse" in some context.
        const mentionsCompany = content.includes(cleanedName.toLowerCase());
        
        if (mentionsCompany || score >= 20) {
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

export const ADVERSE_MEDIA_TERMS = [
  'fraud',
  'fine',
  'investigation',
  'arrest',
  'sanction',
  'lawsuit',
  'criminal',
  'bribery',
  'corruption',
  'kickback',
  'money laundering',
  'bid rigging',
  'conflict of interest',
  'RCMP',
  'blackmail',
  'embezzlement',
];

export function getSeverityTone(score: number): 'high' | 'medium' | 'info' {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'info';
}