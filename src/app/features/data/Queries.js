export const allItemsQuery = `{
    items {
          id
          name
    }
  }`;

export const selectedItemQuery = (id) => `{
    item (id: "${id}") {
          name
          fleaMarketFee
          gridImageLink
          buyFor{
            vendor {
              name
            }
            priceRUB
          }         
          sellFor{
            vendor {
              name
            }
            priceRUB
          }   
          usedInTasks {
            name
            minPlayerLevel
            trader {
                name
            }
            objectives {
                description                  
            }
            wikiLink         
          }      
    }
  }`;
