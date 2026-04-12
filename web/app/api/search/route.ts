import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "Missing query" }, { status: 400 });
  }

  const resp = await fetch(
    `https://api.letterboxd.com/api/v0/search?input=${encodeURIComponent(query)}&include=FilmSearchItem&perPage=10`,
    { headers: { Accept: "application/json" } }
  );

  if (!resp.ok) {
    return Response.json(
      { error: "Letterboxd API error" },
      { status: resp.status }
    );
  }

  const data = await resp.json();
  const results = (data.items ?? []).map(
    (item: {
      film?: {
        name?: string;
        releaseYear?: number;
        rating?: number;
        poster?: { sizes?: { url?: string }[] };
        directors?: { name?: string }[];
        link?: string;
      };
    }) => {
      const film = item.film ?? {};
      const posterSizes = film.poster?.sizes ?? [];
      return {
        name: film.name ?? "",
        year: film.releaseYear ?? null,
        rating: film.rating ?? null,
        posterUrl: posterSizes[posterSizes.length - 1]?.url ?? "",
        posterSmall: posterSizes[0]?.url ?? "",
        directors: (film.directors ?? []).map((d) => d.name),
        link: film.link ?? "",
      };
    }
  );

  return Response.json({ results });
}
