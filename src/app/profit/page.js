import GraphQL from "../features/data/GraphQL";
// import { Items } from "../temp/Items";

export default async function Page() {
  return;

  // const query = `{
  //       items (limit: 20) {
  //             id
  //             name
  //             fleaMarketFee
  //             buyFor {
  //                 vendor {
  //                     normalizedName
  //                 }
  //                 priceRUB
  //             }
  //             sellFor {
  //                 vendor {
  //                     normalizedName
  //                 }
  //                 priceRUB
  //             }
  //       }
  //     }`;

  //   // items array
  // //   const allItems = (await GraphQL(query)).items;
  // const allItems = Items;

  //   let items = allItems.reduce((acc, item) => {
  //     if (
  //       item.fleaMarketFee !== null &&
  //       item.buyFor.length > 0 &&
  //       item.sellFor.length > 0
  //     ) {
  //       const buy = item.buyFor.reduce((min, buyAt) => {
  //         if (buyAt.priceRUB < min) {
  //           min = {
  //             vendor: buyAt.vendor.name,
  //             priceRUB: buyAt.priceRUB,
  //           };
  //         }
  //         return min;
  //       }, 1000000000);

  //       const sell = item.sellFor.reduce((acc, sellAt) => {
  //         if (sellAt.priceRUB > acc.priceRUB) {
  //           acc = {
  //             max: {
  //                 vendor: sellAt.vendor.name,
  //                 priceRUB: sellAt.priceRUB,
  //             },
  //             s : {
  //                 vendor: acc.max.vendor,
  //                 priceRUB: acc.max.priceRUB,
  //             }

  //           };
  //         }
  //         return acc;
  //       }, {});

  //       const updated = {
  //         id:
  //         profit: maxSell - minBuy,
  //       };
  //       acc.push(updated);
  //     }
  //     return acc;
  //   }, []);

  //   items = items
  //     .sort((a, b) => b.profit - a.profit)
  //     .filter((item) => item.profit > 0);

  //   return (
  //     <div className="p-4 flex flex-col gap-4">
  //       {items.map((item) => (
  //         <div key={item.id} className="p-4 border rounded-md shadow">
  //           <h2 className="font-bold">
  //             {item.name} | Profit: {item.profit}
  //           </h2>
  //           <div className="flex flex-row gap-4">
  //             <div>
  //               <h3 className="font-semibold">Buy For</h3>
  //               <ul>
  //                 {item.buyFor.map((buyFor) => (
  //                   <li
  //                     key={item.id}
  //                   >{`${buyFor.vendor.normalizedName}: ${buyFor.priceRUB}`}</li>
  //                 ))}
  //               </ul>
  //             </div>
  //             <div>
  //               <h3 className="font-semibold">Sell For</h3>
  //               <ul>
  //                 {item.sellFor.map((sellFor) => (
  //                   <li
  //                     key={item.id}
  //                   >{`${sellFor.vendor.normalizedName}: ${sellFor.priceRUB}`}</li>
  //                 ))}
  //               </ul>
  //             </div>
  //             <div>
  //               <h3 className="font-semibold">Flea Market Fee</h3>
  //               <p>{item.fleaMarketFee}</p>
  //             </div>
  //           </div>
  //         </div>
  //       ))}
  //     </div>
  //   );
}
