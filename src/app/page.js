import GetData from "./features/data/GetData";
import { Items } from "./temp/items";

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

  return <main className="h-screen"></main>;
}
