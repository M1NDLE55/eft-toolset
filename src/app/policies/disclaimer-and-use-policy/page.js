export default function Page() {
  const policy = {
    heading: "Disclaimer and Use Policy",
    sections: [
      {
        heading: "Introduction",
        content:
          "Welcome to EFT Toolset, a fan-made website offering a suite of tools for players of Escape From Tarkov (EFT). By using this website, you acknowledge and agree to comply with the following disclaimer and use policy. Please read this document carefully before using our services.",
      },
      {
        heading: "Third-Party API Use",
        content:
          "Our website utilizes a third-party API, TARKOV.DEV (https://tarkov.dev/), to fetch information and data related to Escape From Tarkov. While we strive to provide accurate and up-to-date information, we cannot guarantee the accuracy, completeness, or reliability of the data obtained from this API. Users should independently verify any information before relying on it.",
      },
      {
        heading: "No Affiliation with Battlestate Games",
        content:
          "EFT Toolset is an unofficial, fan-made website and is not endorsed, supported, or affiliated with Battlestate Games, the developers of Escape From Tarkov. Any trademarks, logos, or brand names mentioned on this site are the property of their respective owners and are used for identification purposes only.",
      },
      {
        heading: "Use at Your Own Risk",
        content:
          "The use of EFT Toolset and its tools is entirely at your own risk. We are not responsible for any potential issues, losses, or damages that may arise from using our website or the information provided. This includes, but is not limited to, in-game consequences, data loss, or any other impact on your gaming experience.",
      },
      {
        heading: "Accuracy of Information",
        content:
          "While we make every effort to ensure the information on our website is accurate and up-to-date, we cannot guarantee its completeness or accuracy. Escape From Tarkov is subject to frequent updates and changes, which may affect the validity of the information provided. Users are encouraged to verify information through official sources whenever possible.",
      },
      {
        heading: "External Links",
        content:
          "Our website may contain links to third-party websites or resources. We are not responsible for the content, availability, or accuracy of these external sites. Users should exercise caution when visiting external links and review the terms and privacy policies of any third-party sites.",
      },
      {
        heading: "Limitation of Liability",
        content:
          "To the fullest extent permitted by law, EFT Toolset and its administrators disclaim all warranties, express or implied, regarding the website and its content. We shall not be liable for any direct, indirect, incidental, consequential, or punitive damages arising from the use or inability to use our website and its tools.",
      },
      {
        heading: "Changes to the Disclaimer and Use Policy",
        content:
          "We reserve the right to modify this disclaimer and use policy at any time without prior notice. Any changes will be posted on this page, and it is the user's responsibility to review this document periodically to stay informed of any updates.",
      },
      {
        heading: "Conclusion",
        content:
          "By using EFT Toolset, you agree to the terms outlined in this disclaimer and use policy. If you do not agree with these terms, please do not use our website.",
      },
    ],
  };

  return (
    <main className="flex justify-center p-4 min-h-[calc(100vh-128px)]">
      <div className="text-neutral-200 max-w-xl w-full flex flex-col gap-4">
        <h1 className="text-3xl font-bold py-4 text-center">
          {policy.heading}
        </h1>
        <ol className="list-decimal pl-6">
          {policy.sections.map((section, i) => (
            <li key={i} className="text-xl mb-4">
              <h2>{section.heading}</h2>
              <p className="text-base">{section.content}</p>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
