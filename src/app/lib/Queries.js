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
            width
            height
            changeLast48hPercent
            bartersUsing {
              trader {
                name
              }
              level
              taskUnlock {
                name
                trader {
                  name
                }
                minPlayerLevel
              }
              requiredItems {
                item {
                  name
                }
                quantity
              }
              rewardItems {
                item {
                  name
                }
                quantity
              }
            }
            craftsUsing {
              station {
                name
              }
              level
              taskUnlock {
                name
                trader {
                  name
                }
                minPlayerLevel
              }
              requiredItems {
                item {
                  name
                }
                quantity
              }
              rewardItems {
                item {
                  name
                }
                quantity
              }
            }  
      }
    }`;
