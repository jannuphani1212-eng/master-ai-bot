# Affiliate Video Studio

## What it does

The Affiliate Video Studio creates and saves bilingual English + Telugu campaign drafts for YouTube Shorts and Instagram Reels. It supports the dashboard's major product-category list and keeps the affiliate brand separate from Global Rhymes 4U.

## Owner workflow

1. Sign in through the Owner Approval Center.
2. Enter a product name and category.
3. Optionally enter the merchant, product page URL, approved affiliate URL, commission rate and product facts.
4. Generate the video package. The backend asks the AI for English and Telugu hooks, scripts, scene plans, titles, captions, hashtags and affiliate disclosures for both Shorts and Reels.
5. Review the saved draft. Product-page URLs are not fetched by this feature; product facts, price, ratings, availability and commission terms remain unverified until supported by an official source.
6. Only after the affiliate program has approved the owner and issued a valid HTTPS tracking URL should the owner include that URL and approve link tracking.
7. The dashboard exposes separate tracked links for YouTube Shorts and Instagram Reels. The redirect records a click and sends the visitor to the stored HTTPS affiliate URL.

## Accuracy and safety

- Draft generation never publishes or schedules content.
- The campaign remains a draft until the owner approves link tracking.
- A campaign without an affiliate URL cannot be approved for tracking.
- A user-entered commission rate is marked `owner_supplied_unverified`.
- Only offers with an officially verified commission above 5% may be labelled recommended; unknown or lower rates remain research leads.
- The redirect endpoint never accepts an arbitrary destination URL from the visitor. It redirects only to the HTTPS URL saved in the campaign record.
- Click events store campaign ID, owner ID, source platform and timestamp. They do not store IP addresses or user-agent strings.
- Clicks are not sales. No revenue or commission is inferred from views or clicks.

## Commission report import

The dashboard accepts an owner-pasted CSV normalized to this header format:

```csv
order_id,report_date,commission_amount,currency,status
ORDER-001,2026-11-14,12.50,INR,paid
ORDER-002,2026-11-13,5.00,INR,pending
```

The program name and report reference are entered separately. Supported statuses are `pending`, `approved`, `paid` and `void`. Each imported row is saved as `needs_owner_review`. The owner must confirm each row against the original official report before it contributes to verified totals. Re-importing the same program/order ID updates the row and returns it to review. Clicks and views are never counted as commissions.

## Not implemented yet

- Live catalog/product research from Amazon or other affiliate program APIs.
- Direct affiliate-program order/commission APIs, automatic CSV file parsing from arbitrary vendor formats, returns/cancellations, payout reconciliation or net-profit reporting.
- Instagram Reels publishing and YouTube video publishing.
