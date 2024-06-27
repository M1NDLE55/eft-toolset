export default async function GraphQL(query) {
  try {
    const response = await fetch("https://api.tarkov.dev/graphql", {
      // cache: "no-cache",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: query,
      }),
    });

    if (!response.ok) {
      throw new Error("Network response was not ok" + response.statusText);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}
