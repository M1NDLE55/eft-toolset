export default async function GraphQL(query, options = {}) {
  try {
    const response = await fetch("https://api.tarkov.dev/graphql", {
      ...options,
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
      return {
        errors: [
          {
            message: `Network response was not ok: status '${response.statusText}'`,
          },
        ],
      };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.log(error.toString());
    return {
      errors: [
        {
          message: "A problem occured while fetching the data",
        },
      ],
    };
  }
}
