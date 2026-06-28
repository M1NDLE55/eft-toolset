# EFT Toolset

Welcome to EFT Toolset! This application provides a suite of tools to assist players of Escape From Tarkov (EFT) in their gameplay experience.

## Current Tools

### 1. **Item Scanner**
Provides a concise summary of an item, including purchase and sale information (vendors and flea market), as well as its usage in tasks, barters, and crafts. It is especially useful while in raid.

### 2. **Item Groups**
Create and manage custom item groups for tracking related gear or loot. Groups are saved locally in the browser.

### 3. **Gun Builder**
Create weapon builds from tarkov.dev weapon and attachment data. The builder supports default presets, compatible slot picking, calculated prices and stats, local build storage, duplication, renaming, deletion, and shareable build links that can be imported by other users.

## API Integration

This web app uses the following API(s) to provide real-time data and up-to-date information:

- **API Name**: [TARKOV.DEV](https://tarkov.dev)

The app fetches item, pricing, weapon, attachment, and preset data from tarkov.dev and caches data locally for faster repeat use.

## Installation

To get started with EFT Toolset locally, follow these steps:

1. **Clone the repository:**
    ```bash
    git clone https://github.com/M1NDLE55/eft-toolset.git
    ```
2. **Navigate to the project directory:**
    ```bash
    cd eft-toolset
    ```
3. **Install the dependencies:**
    ```bash
    npm install
    ```
4. **Run the development server:**
    ```bash
    npm run dev
    ```

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

## Contact

For any bugs, suggestions, or questions, please open an issue here: [Issues](https://github.com/M1NDLE55/eft-toolset/issues).
