export const itemMetaQuery = (name) => `{
    items (name: "${name}") {
          inspectImageLink 
    }
  }`;

export const allItemsQuery = `{
      items {
            name
      }
    }`;

export const itemDataQuery = (name) => `{
      items (name: "${name}") {
            fleaMarketFee
            gridImageLink
            wikiLink
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
