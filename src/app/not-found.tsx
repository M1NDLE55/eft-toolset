import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex justify-center flex-col gap-4 items-center p-4 min-h-[calc(100vh-128px)] text-neutral-200">
      <h1 className="text-center text-4xl">404</h1>
      <p className="text-center text-xl">
        The page you&apos;re looking for doesn&apos;t exist
      </p>
      <Link
        href={{ pathname: "/" }}
        className="bg-neutral-700 text-white rounded-md p-3 text-xl shadow-md hover:shadow-neutral-500 transition-all"
      >
        Take Me Back
      </Link>
    </main>
  );
}
