import GetData from "./features/data/GetData";
import { Items } from "./temp/Items";

export default async function Home() {
  const getItems = `{
                items {
                      id
                      name
                      fleaMarketFee
                      sellFor {
                          vendor {
                              name
                          }
                          price
                      }
                }
              }`;

  // items array
  const items = Items;
  // const items = (await GetData(getItems)).data.items;

  return (
    <main className="h-screen">
      <div className="p-4 flex flex-col gap-4">
        {items.map(
          (item) =>
            item.fleaMarketFee && (
              <div key={item.id} className="p-4 border rounded-md shadow">
                <h2 className="font-bold">{item.name}</h2>
                <div className="flex flex-row gap-4">
                  <div>
                    <h3 className="font-semibold">Buy For</h3>
                    <ul>
                      {item.buyFor.map((buyFor) => (
                        <li
                          key={`${item.id}${buyFor.vendor.normalizedName}${buyFor.price}`}
                        >{`${buyFor.vendor.normalizedName}: ${buyFor.price}`}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold">Sell For</h3>
                    <ul>
                      {item.sellFor.map((sellFor) => (
                        <li
                          key={`${item.id}${sellFor.vendor.normalizedName}${sellFor.price}`}
                        >{`${sellFor.vendor.normalizedName}: ${sellFor.price}`}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )
        )}
      </div>
    </main>
  );
}
