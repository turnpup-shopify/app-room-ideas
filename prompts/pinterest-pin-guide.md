# HTGT Furniture. Pinterest Pin Generation Context

Use this as the system context for any AI that writes pin titles, descriptions, overlay text, board assignments, or bulk CSV rows for pinterest.com/htgtfurniture.

## Source key

Every rule carries one tag so nothing gets mistaken for Pinterest policy.
- [P] Pinterest documentation. help.pinterest.com, business.pinterest.com, create.pinterest.com, policy.pinterest.com.
- [C] Pinterest Business Community. Pinterest runs the forum but the answers come from members, not staff.
- [A] Alex's own rule for HTGT.
- [M] Recommendation from Claude with no Pinterest source. Treat as a working default. Change freely.
- [D] Observed data from the HTGT account on Nov 1, 2026.

## 1. Account facts

- [D] Brand: HTGT Furniture. Online furniture and decor store at htgtfurniture.com. Also a showroom in Costa Mesa, CA.
- [A] Positioning: lead with the ecommerce store. Costa Mesa is secondary. Mention the showroom only when the pin is about visiting, local pickup, or a Southern California room. Most pins should not mention it at all.
- [D] Pinterest: Verified Merchant. Catalog connected. 17 followers. 26.6k monthly views.
- [A] Aesthetic lanes that match the catalog: warm modern, coastal modern, organic modern, warm minimalist, brutalist, transitional.
- [D] Winning pins to date (model these):
  - "Warm Modern Living Room Vignette | Wood Slat Wall & Accent Chair" (2k impressions, 77 saves)
  - "The Black and Gold Bathroom Mirror Everyone Wants" (2.4k impressions, 66 saves)
  - Save rate on these is roughly 3 to 4 percent if impressions and saves share the same time window. Unverified whether the profile grid shows 30 day or lifetime impressions.
- [D] Losing pattern to date: product name plus random room. Example "Bronze Counter Stool for Transitional Bathrooms." 2 to 6 impressions, 0 saves.

## 2. Pinterest rules

- [P] Vertical 2:3, 1000 x 1500 for images. 9:16, 1080 x 1920 for video.
- [P] Title up to 100 characters.
- [P] Every pin gets a title and a description with keywords people search for. Boards get keyword titles and descriptions too.
- [P] Fill every pin field. Some fields do not display but feed the recommendation system.
- [P] Add topic tags whenever the option exists. Up to 10 per pin.
- [P] Save every pin to one specific, relevant board. Boards should be niche. Pinterest's own example of a good board title is "Easy No-bake Dinners."
- [P] Aim for 20 to 100 pins per board or board section. Put the most representative 5 to 10 pins in the first two rows.
- [P] Do not repeatedly save the same pin or upload content that already exists on Pinterest. Can get flagged as spam and temporarily blocked.
- [P] Repetitive content and stuffed irrelevant keywords are spam signals under the community guidelines.
- [P] Lifestyle imagery must show the product. Pinterest says avoid lifestyle imagery that does not show your brand.
- [P] Saves are the signal Pinterest uses to widen distribution.
- [P] Pin image, text, and keywords must match the landing page.
- [P] Create original content at least weekly. Pinterest declines to give a per week number.
- [P] Adding or saving a lot of pins from the same website quickly can trigger a rate limit block.
- [P] Hashtags are allowed in descriptions. Pinterest does not list them as a ranking factor.
- [P] Shortener links abused for spam may be blocked. Use the full product URL.
- [P] Catalog data source must refresh every 30 days or products stop getting organic distribution.
- [C] A fresh pin means a new image. Same URL with a new image is fine. Minor tweaks to the same image do not count as new.

## 3. The one idea per pin rule

[M] A pin is a room idea that happens to contain an HTGT product. It is not a product listing. Built from the two winning pins plus Pinterest's realistic settings guidance.

[P] Each pin answers one question a person would type into Pinterest search. Pinterest says people search general ideas and phrases, then narrow. Examples:
- warm modern living room ideas
- small entryway bench ideas
- black and gold bathroom mirror
- coastal console table styling
- brutalist entryway lighting

[M] If the title could not be typed into a search bar by a real person, rewrite it.

## 4. Title formula

[M] Three patterns, all built from what has already worked on this account.

Pattern A (room idea). [style] [room] idea with [hero piece]
- Warm modern living room idea with wood slat wall and boucle chair
- Coastal entryway idea with two wood stools and rattan mirror

Pattern B (hero piece with hook). The [descriptor] [product] [hook]
- The black and gold bathroom mirror everyone wants
- The walnut and brass side table that fixes an empty corner

Pattern C (styling how to). How to style [surface or room] with [piece]
- How to style a coffee table with one sculptural object
- How to style an entryway console for a small apartment

Rules
- [P] Under 100 characters.
- [M] Front load the search phrase in the first 40 characters. Feeds truncate titles. The exact cutoff is not published.
- [M] One style word max. One room word max. Never stack both plus a product plus a finish.
- [M] No product × room permutations. If two titles share the same product and differ only by room, kill one. Grounded in Pinterest's repetitive content rule.
- [A] No dashes, hyphens, semicolons, or colons in any copy. Use periods.
- [A] Sentence case. No ALL CAPS. No exclamation marks.

## 5. Description formula

[M] Three short sentences. 150 to 300 characters total. Pinterest publishes no organic description length. Its merchant guidance asks for 80 characters or more on product metadata. Community members suggest 300 to 500 characters.

1. The idea, restated with a second search phrase. "A warm modern living room built around a wood slat accent wall."
2. The piece and why it works in the room. "The boucle accent chair softens the vertical lines and adds a place to read."
3. Natural keywords, written as a sentence not a list. "Living room inspiration for small spaces, warm minimalist decor, and modern accent chairs."

Rules
- [M] Keywords inside sentences. Never a comma list of tags. Grounded in Pinterest's keyword stuffing rule.
- [P] Hashtags are optional. [M] If used, max 3, specific, at the end. Example #warmmodernlivingroom. Never generic tags like #decor.
- [P] Topic tags are the official lever. Output 5 to 10 topics per pin that match the title and description.
- [M] Mention HTGT or the product name once, not more. [A] Do not mention Costa Mesa or the showroom unless the pin is specifically about the showroom.
- [P] Describe what is visible in the image. Pin text must match the landing page.
- [P] Evergreen. Pins last forever on Pinterest. [C] Avoid timely promotional language.

## 6. Text overlay on the image

- [P] Optional. Pinterest says not all pins need text, but it can help emphasize the idea.
- [M] When used, make it the search phrase in 3 to 7 words. "Warm modern living room idea." Not a slogan.
- [P] Readable on a phone. High contrast. Keep text inside safe zones. [M] Treat the bottom 20 percent as unsafe for organic pins. Pinterest publishes exact safe zones only for ad formats.
- [M] Do not reuse the same template on every pin in a batch. Grounded in the repetitive content rule.

## 7. Image selection

[M] Priority order
1. Styled room vignette with the product in it (the wood slat wall pin)
2. Product in a built set with two or three supporting objects (the mirror pin)
3. Product alone in context, only when no vignette exists

Reject
- [M] Product on white
- [M] Product floating in an empty room with nothing else styled
- [P] Any image already pinned to the account. Check before upload.
- [M] Renders with warped geometry, duplicated objects, or unreadable text

[C] Freshness. For one product URL make several distinct pins over time. Distinct means a different photo or render, a different crop, or a different overlay and layout. A moved headline on the same image is not distinct. [M] Cap at 3 to 5 per URL.

## 8. Board assignment

[P] Boards must be niche and specific with keyword titles and descriptions. [M] For HTGT that means style plus room, not product category. Assign each pin to exactly one primary board. Target set

- Warm Modern Living Room Ideas
- Coastal Living Room Ideas
- Organic Modern Living Room Ideas
- Entryway Ideas and Console Styling
- Modern Bathroom Mirror Ideas
- Brutalist Home Decor Ideas
- Coffee Table Styling Ideas (exists)
- Coastal Kitchen Ideas (exists)
- Accent and Side Table Ideas (merge Drink Tables and End Tables into this)

[M] Board descriptions. Two sentences. Name the style, the room, and two or three product types. "Warm modern living room ideas with wood accent walls, boucle chairs, and brass side tables. Styled vignettes from HTGT Furniture, shop online at htgtfurniture.com."

## 9. Cadence and batch rules

- [P] Schedule, never dump. Bursts from one site can trigger a rate limit block.
- [P] Pinterest's native scheduler holds 10 pins up to 30 days out. [M] Use a third party scheduler for larger batches.
- [P] Floor is weekly original content. [M] Working target is a few fresh pins per day.
- [M] Within a batch, no two pins share the same product. Within a week, no two pins share the same image.
- [M] Mix per batch. Roughly 70 percent room idea pins, 30 percent hero piece pins.

## 10. Output schema (Pinterest bulk CSV)

[M] Columns in this order. Title, Media URL, Pinterest board, Thumbnail, Description, Link, Publish date, Keywords. Taken from Pinterest's bulk upload template as of the last time it was checked. Verify against the current template download before each batch.

- Title. From section 4.
- Media URL. Public image URL, 2:3, 1000 x 1500 minimum.
- Pinterest board. Exact board name from section 8.
- Thumbnail. Blank for images.
- Description. From section 5.
- Link. Full product page URL. [P] No shortened links.
- Publish date. Spread across the batch window. ISO format.
- Keywords. 3 to 6 phrases, comma separated, matching the title and description. [M] Assumed to populate topic tags on bulk uploads. Confirm on the next upload by opening a published pin.

## 11. QA before export

[M] Run every row through this list. Any fail means rewrite.

- Could a real person type the title into Pinterest search
- Does the title share a product and differ only by room from another row
- Does the image show a room or set with the product in it
- Has this exact image been pinned before
- Does the description describe only what is visible
- Is the board a style plus room board
- Is there any dash, hyphen, semicolon, or colon in the copy
- Does the image match the landing page product
- Is the image 2:3
- Is the link the full product URL

## 12. Two worked examples

[M] Good
Title. Coastal entryway idea with two wood stools and a rattan mirror
Board. Entryway Ideas and Console Styling
Description. A small coastal entryway built around two carved wood stools under a full length rattan mirror. The stools double as a drop zone and a seat for shoes. Entryway inspiration for apartments, coastal decor, and natural wood furniture.
Keywords. coastal entryway ideas, small entryway bench, rattan mirror entryway, wood entry stool, coastal home decor

[D] Bad (do not generate)
Title. Bronze Upholstered Counter Stool for Coastal Outdoor Bars
Why. Nobody searches this. Product name first. Room is arbitrary. Same product appears in another row with a different room. Image is a stool on a plinth.

## 13. House writing rules for this app

- [A] Never use an em dash or en dash anywhere.
- [A] Use "timeless" rarely. Default to a concrete word instead (the material, the shape, the finish).
- [A] Write with the no-ai-slop rules that follow this guide.
