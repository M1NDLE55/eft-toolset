export type Group = {
  name: string;
  items: string[];
};

export type Item = {
  name: string;
  gridImageLink: string;
};

export type Data = {
  items: {
    gridImageLink: string;
  }[];
  errors?: {
    message: string;
  }[];
};
