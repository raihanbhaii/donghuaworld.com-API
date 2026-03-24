# GraphQL Examples

**Playground URL:** `https://your-app.onrender.com/graphql`  
Open it in your browser for the interactive IDE with autocomplete.

---

## Full Homepage (one request)
```graphql
{
  home {
    hero {
      title slug thumbnail synopsis rating genres episode
    }
    latestEpisodes {
      results { title slug thumbnail episode type }
    }
    trending {
      rank title slug thumbnail rating
    }
    popular {
      results { title slug thumbnail rating status }
    }
    ongoing {
      results { title slug thumbnail latestEpisode }
    }
    genres {
      name slug
    }
  }
}
```

---

## Search
```graphql
{
  search(q: "battle through the heavens") {
    count
    results { title slug thumbnail rating type }
  }
}
```

---

## Series Detail + Episodes
```graphql
{
  series(slug: "battle-through-the-heavens") {
    title synopsis thumbnail rating views genres
    info { key value }
    totalEpisodes
    episodes { number title date url slug }
    related { title slug thumbnail }
  }
}
```

---

## Episode + Video Servers
```graphql
{
  episode(slug: "battle-through-the-heavens-episode-1") {
    title seriesUrl
    servers { server embedUrl }
    serverPicker { label embedUrl }
    directVideoLinks
    downloads { label url }
    navigation { prev next }
  }
}
```

---

## Latest Episodes (paginated)
```graphql
{
  latestEpisodes(page: 1) {
    page count
    results { title slug thumbnail episode type rating }
  }
}
```

---

## Trending
```graphql
{
  trending {
    rank title slug thumbnail rating
  }
}
```

---

## Popular (page 2)
```graphql
{
  popular(page: 2) {
    page count
    results { title slug thumbnail rating status }
  }
}
```

---

## Ongoing / Airing
```graphql
{
  ongoing(page: 1) {
    count
    results { title slug thumbnail latestEpisode }
  }
}
```

---

## Top Rated
```graphql
{
  topRated(page: 1) {
    count
    results { title slug rating thumbnail }
  }
}
```

---

## Movies
```graphql
{
  movies(page: 1) {
    count
    results { title slug thumbnail rating }
  }
}
```

---

## Browse by Genre
```graphql
{
  byGenre(genre: "action", page: 1) {
    count
    results { title slug thumbnail rating }
  }
}
```

---

## All Genres List
```graphql
{
  genres {
    name slug url
  }
}
```

---

## Filter (multi-param)
```graphql
{
  filter(genre: "action", status: "ongoing", order: "popular", year: "2024") {
    count
    results { title slug thumbnail rating type }
  }
}
```

---

## A–Z Browse
```graphql
{
  az(letter: "B", page: 1) {
    count
    results { title slug thumbnail }
  }
}
```

---

## By Year
```graphql
{
  byYear(year: "2024", page: 1) {
    count
    results { title slug thumbnail rating }
  }
}
```

---

## By Type
```graphql
{
  byType(type: "donghua", page: 1) {
    count
    results { title slug thumbnail }
  }
}
```

---

## Weekly Schedule
```graphql
{
  schedule {
    day
    items { title slug time thumbnail }
  }
}
```

---

## Random Series
```graphql
{
  random {
    title slug thumbnail rating type
  }
}
```

---

## News
```graphql
{
  news(page: 1) {
    title url date excerpt thumbnail
  }
}
```

---

## Completed Series
```graphql
{
  completed(page: 1) {
    count
    results { title slug thumbnail rating }
  }
}
```
