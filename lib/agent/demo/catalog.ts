// Simulated counterparties' items for DEMO mode. Values are rough secondhand USD.
export interface CatalogItem {
  name: string;
  description: string;
  category: string;
  value: number;
  liquidity: number;
  risk: number;
  story: number;
}

const c = (name: string, value: number, category: string, description: string, liquidity = 0.6, risk = 0.15, story = 0.2): CatalogItem => ({
  name, value, category, description, liquidity, risk, story,
});

export const CATALOG: CatalogItem[] = [
  c("Heart-shaped pebble", 0.03, "misc", "Found on a beach in Cornwall. Sentimental value only.", 0.3, 0.05, 0.6),
  c("1990s soda bottle cap", 0.25, "collectibles", "Crystal Pepsi cap, good condition.", 0.4, 0.05, 0.5),
  c("Novelty sushi eraser", 0.5, "misc", "Tuna nigiri eraser, unused.", 0.4, 0.05, 0.4),
  c("Fish-shaped pen", 1.5, "misc", "Novelty pen shaped like a trout. Writes blue.", 0.5, 0.05, 0.5),
  c("Hand-painted doorknob", 4, "home", "Ceramic doorknob with a smiley face, hand painted.", 0.3, 0.05, 0.6),
  c("Pack of Pokémon cards (opened, 10 commons)", 3, "collectibles", "Ten common cards, good condition.", 0.8, 0.1, 0.2),
  c("Vintage Coleman camp stove", 45, "outdoors", "1970s green Coleman two-burner, works.", 0.7, 0.15, 0.4),
  c("Keg-shaped novelty speaker", 25, "electronics", "Bluetooth speaker shaped like a tiny keg. Great bass.", 0.5, 0.1, 0.5),
  c("Used Kindle Paperwhite (10th gen)", 55, "electronics", "Light scratches, charges fine, factory reset.", 0.9, 0.15, 0.1),
  c("Signed copy of a debut novel", 30, "books", "Author-signed first printing, small run.", 0.4, 0.25, 0.6),
  c("Nintendo Switch Lite (coral)", 120, "gaming", "Works, minor scuff, charger included.", 0.95, 0.2, 0.1),
  c("Fender Squier Stratocaster", 160, "instruments", "Sunburst, new strings, small ding on body.", 0.8, 0.15, 0.3),
  c("Snowmobile ride + lunch with a local legend", 250, "experience", "A day out with a well-known local radio host.", 0.2, 0.3, 0.9),
  c("Canon EOS 80D body", 420, "cameras", "38k shutter count, battery + charger.", 0.85, 0.2, 0.1),
  c("Herman Miller Aeron chair (size B)", 450, "home", "Fully loaded, light wear. Local pickup or freight.", 0.6, 0.15, 0.2),
  c("Vintage 1980s arcade cabinet", 900, "gaming", "Working Galaga cab, original marquee.", 0.5, 0.25, 0.7),
  c("Omega Seamaster Quartz (1990s)", 1100, "watches", "Serviced 2023, box no papers, timestamp photos available.", 0.8, 0.3, 0.3),
  c("Gibson Les Paul Studio (2015)", 1400, "instruments", "Wine red, hard case, setup done.", 0.8, 0.25, 0.3),
  c("Rolex Submariner – no photos, ship yours first", 9000, "watches", "Trust me bro. Ship first, no photos sorry.", 0.9, 0.9, 0.1),
  c("Replica designer handbag", 300, "fashion", "1:1 rep, looks identical.", 0.5, 0.6, 0.1),
  c("Antique hunting rifle", 800, "outdoors", "1950s bolt-action rifle, great condition.", 0.4, 0.3, 0.3),
  c("MacBook Pro 14\" M3 Pro", 1700, "computers", "18GB/512GB, battery 96%, AppleCare till 2027.", 0.95, 0.25, 0.1),
  c("Cameo role in an indie film", 2500, "experience", "Speaking walk-on part in a festival-bound indie feature.", 0.2, 0.3, 0.95),
  c("1999 Honda Civic (runs)", 3200, "vehicles", "182k miles, clean title, new tyres.", 0.7, 0.3, 0.4),
  c("Signed Les Paul by a touring band", 4500, "instruments", "Signed by all four members, COA + photo of signing.", 0.5, 0.35, 0.8),
  c("Leica M6 with 35mm Summicron", 5200, "cameras", "Classic film rangefinder kit, CLA'd last year.", 0.75, 0.3, 0.4),
  c("Vintage Airstream trailer (project)", 7500, "vehicles", "1972, 25ft, needs interior work.", 0.4, 0.3, 0.8),
  c("2014 Toyota Tacoma", 14000, "vehicles", "4x4, 120k miles, clean title.", 0.75, 0.3, 0.3),
  c("One-year rent-free in a lake cabin", 12000, "experience", "Small cabin, owner wants the story to go viral.", 0.2, 0.35, 0.95),
  c("Rolex Datejust 36 (full set)", 8500, "watches", "2016, box and papers, serviced, verified by AD.", 0.85, 0.25, 0.3),
  c("Original painting by an emerging artist", 6000, "art", "Gallery-shown large oil on canvas, provenance letter.", 0.3, 0.3, 0.7),
  c("Classic 1967 VW Beetle", 18000, "vehicles", "Restored, numbers matching, show winner.", 0.6, 0.3, 0.8),
  c("Tesla Model 3 (2019)", 22000, "vehicles", "Long range, 60k miles, clean history.", 0.8, 0.3, 0.3),
  c("Patek-adjacent vintage gold watch", 26000, "watches", "18k vintage dress watch with auction-house paperwork.", 0.6, 0.35, 0.5),
  c("Small plot of land (0.5 acre, rural)", 35000, "property", "Buildable lot, clear title, owner loves the project.", 0.3, 0.35, 0.9),
  c("Restored 1972 Ford Bronco", 55000, "vehicles", "Frame-off restoration, documented build.", 0.6, 0.3, 0.8),
  c("Tiny home on wheels", 68000, "property", "Certified build, 28ft, fully off-grid.", 0.4, 0.35, 0.9),
  c("Porsche 911 Carrera (997, 2006)", 42000, "vehicles", "Manual, IMS done, service records.", 0.7, 0.3, 0.6),
  c("Cabin in the woods (small, rural)", 105000, "property", "Two-room cabin on 2 acres. Clear title. Town wants the story.", 0.3, 0.35, 1),
  c("Small A-frame house in a mountain town", 165000, "property", "Two-bed A-frame, needs a roof. The mayor wants the paperclip story.", 0.3, 0.35, 1),
];

export const HANDLES = [
  "u/swapqueen", "@retro_rick", "u/campfire_dan", "@luthier_lou", "u/pixelpete", "@trade_tina", "u/oldmanwatches",
  "@lens_lady", "u/garage_gary", "@vintage_vee", "u/couchcollector", "@mint_condition_mo", "u/boltaction_bob", "@filmfan_fi",
];
