# Frontend Design & Structure Plan

## Overview

Three.ad frontend will use **TanStack Router** for routing and **TanStack Query** for data fetching. The design follows a landing-first approach with a search interface that transitions to a results view with AI chat sidebar.

## Tech Stack

- **React** + **Vite** + **TypeScript**
- **TanStack Router** - File-based routing
- **TanStack Query** - Data fetching and caching
- **Jotai** - State management (for atoms/wallet state)
- **Tailwind CSS 4.x** - Styling (CSS-based config)
- **@solana/kit** - Wallet integration

## Route Structure

```
/                           # Landing page - centered search input
/search                     # Results page - sidebar + masonry grid
  ?q={query}                # Query parameter for search term
  &lat={lat}&lon={lon}&radius={km}  # Optional geo filters
  &min_age={age}&max_age={age}      # Optional age filters
  &interests={comma,separated}      # Optional interest filters
/ad/new                     # Ad creation form
/ad/$id                     # Ad detail page (optional, future)
```

## Page Layouts

### 1. Landing Page (`/`)

**Layout:** Centered, minimal design

**Components:**
- Large search input (Google-style, inherited by AI products)
- Placeholder: "What do you need?"
- Upper right corner: "Post Your Own Ads Now" button → redirects to `/ad/new`

**Behavior:**
- When user submits search query → navigate to `/search?q={query}`
- Transitions from centered layout to sidebar + main content layout

**File:** `routes/index.tsx`

---

### 2. Search Results Page (`/search`)

**Layout:** Split view with sidebar + main content

**Sidebar (320px width in em):**
- AI chat interface
- Fixed width sidebar on left
- Interactive chat for refining search, asking questions about ads

**Main Content:**
- Masonry grid layout for ad cards
- Responsive columns (adjusts based on viewport)
- Cards display in masonry style (Pinterest-like)

**Ad Card Format:**
```
┌─────────────┐
│   Image     │  (from og:image meta tag or fallback)
│             │
├─────────────┤
│   Title     │  (ad.title)
│             │
│ Description │  (ad.description, max 300 chars / 50 words)
│ ...         │
└─────────────┘
```
- Clicking card → opens `ad.link_url` in new tab
- Image sourced from scraping `og:image` meta tag from `link_url`

**File:** `routes/search/index.tsx`

**URL Parameters:**
- `q` - Search query string
- `lat`, `lon`, `radius` - Geo filtering (km)
- `min_age`, `max_age` - Age targeting
- `interests` - Comma-separated interests

---

### 3. Ad Creation Page (`/ad/new`)

**Layout:** Simple form layout

**Form Fields:** (based on `CreateAdRequest` schema)
- Title (required, max 200 chars)
- Description (optional, max 2000 chars)
- Call to Action (optional, max 100 chars)
- Link URL (optional, valid URL)
- Location (optional, max 200 chars)
- Days (required, 1-365)
- Latitude/Longitude (optional, both or neither)
- Min Age / Max Age (optional, numeric)
- Interests (optional, max 5, array)

**Note:** Media upload deferred - will scrape og:image from link_url instead

**File:** `routes/ad/new.tsx`

**Status:** Planning phase - implementation deferred until landing/search pages complete

---

## Component Structure

```
src/
├── routes/
│   ├── __root.tsx           # Root layout (providers: TanStack Query, Jotai, etc.)
│   ├── index.tsx            # Landing page
│   ├── search/
│   │   └── index.tsx        # Results page
│   └── ad/
│       └── new.tsx          # Ad creation form
│
├── components/
│   ├── layout/
│   │   ├── LandingLayout.tsx      # Centered search layout
│   │   └── ResultsLayout.tsx     # Sidebar + main content layout
│   │
│   ├── search/
│   │   ├── SearchInput.tsx        # Google-style search input
│   │   ├── AIChatSidebar.tsx      # 320px em AI chat sidebar
│   │   ├── SearchResults.tsx      # Masonry grid container
│   │   └── SearchFilters.tsx      # Optional: filter UI (geo, age, interests)
│   │
│   ├── ad/
│   │   ├── AdCard.tsx             # Individual ad card component
│   │   ├── AdMasonry.tsx          # Masonry grid wrapper
│   │   └── AdForm.tsx             # Ad creation form
│   │
│   └── ui/
│       ├── Button.tsx              # Base button component
│       ├── Input.tsx               # Base input component
│       └── Card.tsx                # Base card component
│
├── hooks/
│   ├── useWallet.ts               # @solana/kit wallet integration
│   ├── useAds.ts                  # Ad fetching/mutations (uses TanStack Query)
│   ├── usePayment.ts              # x402 payment handling
│   └── useOGImage.ts              # Scrape og:image from URLs
│
├── atoms/                          # Jotai atoms
│   ├── adAtom.ts                   # Ad-related state
│   └── walletAtom.ts               # Wallet connection state
│
├── lib/
│   ├── api.ts                      # API client (calls /api/ads endpoints)
│   ├── solana.ts                   # Solana config
│   └── og-scraper.ts               # Utility to scrape og:image from URLs
│
├── App.tsx                         # Main app component (TanStack Router)
├── main.tsx                        # Entry point
└── index.css                       # Tailwind imports + global styles
```

## Key Decisions & Questions

### ✅ Decided

1. **Routing:** TanStack Router with file-based routing
2. **Data Fetching:** TanStack Query for API calls
3. **State:** Jotai for atoms (wallet, UI state)
4. **Image Handling:** Scrape `og:image` from `link_url` instead of R2 upload
5. **Layout Transition:** Landing page → Results page on search submission
6. **Card Click:** Opens `link_url` in new tab

### ❓ Questions to Resolve

1. **AI Chat Sidebar:**
   - Should it query ads via MCP endpoints (`/mcp/`) as user chats?
   - Or is it a separate feature (help/guidance, not ad querying)?
   - Should chat messages translate to search parameters?

2. **Search URL Persistence:**
   - ✅ Keep query in URL for sharing/bookmarking (decided: yes, via query params)
   - Should filters also be in URL? (yes, for shareable links)

3. **Transition Animation:**
   - Should there be an animation when transitioning from landing to results?
   - Or instant layout shift?

4. **Image Scraping:**
   - Should `og:image` be scraped on frontend (client-side)?
   - Or add a backend service endpoint to fetch/scrape?
   - Caching strategy for scraped images?

5. **Mobile Responsiveness:**
   - How should 320px sidebar behave on mobile?
   - Drawer/modal that slides in?
   - Hidden by default, toggle button?

6. **Pagination/Infinite Scroll:**
   - How to handle large result sets?
   - Pagination buttons or infinite scroll for masonry?

## Implementation Priority

### Phase 1: Landing & Search (Current Focus)
1. ✅ Set up TanStack Router structure
2. ✅ Create landing page with SearchInput
3. ✅ Build results layout (sidebar + masonry)
4. ✅ Implement AdCard with og:image scraping
5. ✅ Connect to `/api/ads` endpoint via TanStack Query

### Phase 2: Ad Creation (Deferred)
1. Create `/ad/new` route
2. Build AdForm component
3. Connect form to `/api/ads` POST endpoint
4. Handle form validation (using shared Zod schemas)

### Phase 3: Enhancements (Future)
1. AI chat sidebar functionality
2. Advanced filters UI
3. Ad detail page
4. Payment integration (x402)

## TanStack Libraries

- **@tanstack/react-router** - File-based routing
- **@tanstack/react-query** - Data fetching, caching, mutations
- **@tanstack/react-virtual** (optional) - Virtual scrolling for large lists
- **@tanstack/react-table** (optional) - If tabular views needed later

## Styling Notes

- Use Tailwind CSS 4.x (CSS-based config)
- Masonry layout: User will provide Tailwind cheat (pending)
- Responsive design: Mobile-first approach
- Sidebar: `320px` width in `em` units

## API Integration

**Endpoints Used:**
- `GET /api/ads?query={q}&...` - Search/query ads
- `POST /api/ads` - Create new ad (Phase 2)
- `GET /api/ads/:id` - Get ad details (optional, future)

**TanStack Query Setup:**
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      cacheTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});
```

## Next Steps

1. ✅ Document structure (this file)
2. ⏳ Set up frontend project structure
3. ⏳ Initialize TanStack Router
4. ⏳ Build landing page
5. ⏳ Build search results page

---

**Last Updated:** 2025-11-01  
**Status:** Planning Complete - Ready for Implementation

