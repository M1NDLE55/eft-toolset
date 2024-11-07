import { ApolloError } from "@apollo/client";
import ErrorWrapper from "./error";

export default function QueryError({
  error,
}: {
  error: ApolloError | undefined;
}) {
  return (
    <ErrorWrapper>
      <div className="flex flex-col gap-2">
        {error?.graphQLErrors &&
          error.graphQLErrors.map((error, i) => (
            <p className="text-red-700" key={error.message + `${i}`}>
              {error.message}
            </p>
          ))}
        {error?.networkError && (
          <p className="text-red-700">{error.networkError.message}</p>
        )}
        {!error && <p className="text-red-700">An unexpected error occured</p>}
      </div>
    </ErrorWrapper>
  );
}
