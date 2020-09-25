import { Provider } from "next-auth/client";
import { AppProps } from "next/app";

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <Provider session={pageProps.session}>
      <Component {...pageProps}></Component>
    </Provider>
  );
};

export default App;
