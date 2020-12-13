<p align="center">
  <img src="https://i.imgur.com/UCZEhIO.png" />
</p>

# Passwordless Authentication with Next.js, Prisma, and next-auth

In this post, you'll learn how to add passwordless authentication to your [Next.js](https://nextjs.org/) app using [Prisma](https://www.prisma.io/docs/getting-started/quickstart-typescript) and [next-auth](https://github.com/nextauthjs/next-auth). By the end of this tutorial, your user will be able to log in to your app with either their GitHub account or a Slack-style _magic link_ sent right to their Email inbox.

Prisma is a type-safe database client that replaces traditional ORMs, and makes database access easy with an auto-generated query builder. Coupled with `next-auth`, we only need a few steps to implement the complete authentication mechanism, and don't need to write any SQL code ourselves.

If you want to follow along, clone [this repo](https://github.com/hexrcs/prisma-next-auth) and switch to the [`start-here`](https://github.com/hexrcs/prisma-next-auth/tree/start-here) branch! 😃

![`next-auth` OAuth demo](https://i.imgur.com/tVbypFW.gif)<figcaption>Check out the slick auth flow!</figcaption>

**[👉 See Dev.to Post! 📕](https://dev.to/prisma/passwordless-authentication-with-next-js-prisma-and-next-auth-5g8g)**

## Step 0: Dependencies and database setup

Before we start, let's install Prisma and `next-auth` into the Next.js project.

```
npm i next-auth

npm i -D @prisma/cli @types/next-auth
```

_I'm using TypeScript in this tutorial, so I'll also install the type definitions for `next-auth`_

You will also need a PostgreSQL database to store all the user data and active tokens.

If you don't have access to a database yet, Heroku allows us to host PostgreSQL databases for free, super handy! You can check out [this post](https://dev.to/prisma/how-to-setup-a-free-postgresql-database-on-heroku-1dc1) by [Nikolas Burk](https://dev.to/nikolasburk) to see how to set it up.

If you are a Docker fan and would rather keep everything during development local, you can also check out [this video](https://egghead.io/lessons/postgresql-set-up-and-run-a-postgresql-instance-locally-with-docker-compose?pl=build-a-full-stack-app-with-prisma-2-7c81) I did on how to do this with Docker Compose.

Before moving on to the next step, make sure you have a PostgreSQL URI in this format:

```
postgresql://<USER>:<PASSWORD>@<HOST_NAME>:<PORT>/<DB_NAME>
```

## Step 1: Initialize Prisma

Awesome! Let's generate a starter Prisma schema and a `@prisma/client` module into the project.

```
npx prisma init
```

Notice that a new directory `prisma` is created under your project. This is where all the database magic happens. 🧙‍♂️

Now, replace the dummy database URI in `/prisma/.env` with your own.

![Project structure after running `npx prisma init`](https://i.imgur.com/s0VLzsg.png)<figcaption>Project structure after running <code>npx prisma init</code></figcaption>

## Step 2: Define database schema for authentication

`next-auth` requires us to have [specific tables in our database](https://next-auth.js.org/schemas/models) for it to work seamlessly. In our project, the schema file is located at `/prisma/schema.prisma`.

Let's use the [_default schema_](https://next-auth.js.org/schemas/adapters#prisma-schema) for now, but know that you can always [extend or customize](https://next-auth.js.org/schemas/adapters#custom-models) the data models yourself.

> Note: If you have an existing database, after replacing the dummy database URI, you can run `npx prisma introspect` to generate the `schema.prisma` for your database and work from there. Then, you should add the following data models to the generated `schema.prisma` file.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Account {
  id                 Int       @default(autoincrement()) @id
  compoundId         String    @unique @map(name: "compound_id")
  userId             Int       @map(name: "user_id")
  providerType       String    @map(name: "provider_type")
  providerId         String    @map(name: "provider_id")
  providerAccountId  String    @map(name: "provider_account_id")
  refreshToken       String?   @map(name: "refresh_token")
  accessToken        String?   @map(name: "access_token")
  accessTokenExpires DateTime? @map(name: "access_token_expires")
  createdAt          DateTime  @default(now()) @map(name: "created_at")
  updatedAt          DateTime  @default(now()) @map(name: "updated_at")

  @@index([providerAccountId], name: "providerAccountId")
  @@index([providerId], name: "providerId")
  @@index([userId], name: "userId")

  @@map(name: "accounts")
}

model Session {
  id           Int      @default(autoincrement()) @id
  userId       Int      @map(name: "user_id")
  expires      DateTime
  sessionToken String   @unique @map(name: "session_token")
  accessToken  String   @unique @map(name: "access_token")
  createdAt    DateTime @default(now()) @map(name: "created_at")
  updatedAt    DateTime @default(now()) @map(name: "updated_at")

  @@map(name: "sessions")
}

model User {
  id            Int       @default(autoincrement()) @id
  name          String?
  email         String?   @unique
  emailVerified DateTime? @map(name: "email_verified")
  image         String?
  createdAt     DateTime  @default(now()) @map(name: "created_at")
  updatedAt     DateTime  @default(now()) @map(name: "updated_at")

  @@map(name: "users")
}

model VerificationRequest {
  id         Int      @default(autoincrement()) @id
  identifier String
  token      String   @unique
  expires    DateTime
  createdAt  DateTime  @default(now()) @map(name: "created_at")
  updatedAt  DateTime  @default(now()) @map(name: "updated_at")

  @@map(name: "verification_requests")
}
```

Let's break it down a bit:

In the schema file, we defined 4 data models - `Account`, `Session`, `User` and `VerificationRequest`. The `User` and `Account` models are for storing user information, the `Session` model is for managing active sessions of the user, and `VerificationRequest` is for storing valid tokens that are generated for magic link Email sign in.

The `@map` attribute is for mapping the Prisma field name to a database column name, such as `compoundId` to `compound_id`, which is what `next-auth` needs to have it working.

> [_snake_case_](https://en.wikipedia.org/wiki/Snake_case) is often used as a naming convention in database environments, but [_camelCase_](https://en.wikipedia.org/wiki/Camel_case) is how we usually name things in JavaScript and TypeScript. It's perfectly fine to name Prisma fields in _snake_case_, but it wouldn't look so nice. :)

Next, let's run these commands to populate the database with the tables we need.

```
npx prisma migrate save --experimental
npx prisma migrate up --experimental
```

Then, run this command to generate a Prisma client tailored to the database schema.

```
npx prisma generate
```

Now, if you open up [Prisma Studio](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-studio) with the following command, you will be able to inspect all the tables that we just created in the database.

```
npx prisma studio
```

![Prisma studio screenshot](https://i.imgur.com/DmeUlem.png)<figcaption>Prisma Studio model selection</figcaption>

## Step 3: Configure `next-auth`

Before we start configuring `next-auth`, let's create another `.env` file in the project root.

Now, let's create a new file at `/pages/api/auth/[...nextauth].ts` as a "catch-all" [Next.js API route](https://nextjs.org/docs/api-routes/introduction) for all the requests sent to `your-app-url-root/api/auth` (like `localhost:3000/api/auth`).

Inside the file, first import the essential modules from `next-auth`, and define an API handler which passes the request to the `NextAuth` function, which sends back a response that can either be an entirely generated login form page or a callback redirect. To connect `next-auth` to the database with Prisma, you will also need to import `PrismaClient` and initialize a Prisma client instance.

```ts
import { NextApiHandler } from "next";
import NextAuth from "next-auth";
import Providers from "next-auth/providers";
import Adapters from "next-auth/adapters";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// we will define `options` up next
const authHandler: NextApiHandler = (req, res) => NextAuth(req, res, options);
export default authHandler;
```

Now let's create the `options` object. Here, you can choose from a [wide variety of builtin authentication providers](https://next-auth.js.org/configuration/providers#sign-in-with-oauth). In this tutorial, we will use GitHub OAuth and "magic links" Email to authenticate the visitors.

### Step 3.1: Set up GitHub OAuth

For the builtin OAuth providers like GitHub, you will need a `clientId` and a `clientSecret`, both of which can be obtained by registering a new OAuth app at Github.

First, log into your GitHub account, go to [_Settings_](https://github.com/settings/profile), then navigate to [_Developer Settings_](https://github.com/settings/apps), then switch to [_OAuth Apps_](https://github.com/settings/developers).

![GitHub OAuth apps](https://i.imgur.com/4eQrMAs.png)<figcaption>GitHub OAuth apps</figcaption>

Clicking on the _Register a new application_ button will redirect you to a registration form to fill out some information for your app. The _Authorization callback URL_ should be the Next.js `/api/auth` route that we defined earlier (`http://localhost:3000/api/auth`).

An important thing to note here is that the _Authorization callback URL_ field only supports 1 URL, unlike Auth0, which allows you to add additional callback URLs separated with a comma. This means if you want to deploy your app later with a production URL, you will need to set up a new GitHub OAuth app.

![Registering an OAuth app](https://i.imgur.com/tYtq5fd.png)<figcaption>Registering an OAuth app</figcaption>

Click on the _Register Application_ button, and then you will be able to find your newly generated Client ID and Client Secret. Copy this info into your `.env` file in the root directory.

![Obtaining OAuth Client ID and Client Secret](https://i.imgur.com/QwEjV9s.png)<figcaption>Obtaining OAuth Client ID and Client Secret</figcaption>

Now, let's go back to `/api/auth/[...nextauth].ts` and create a new object called `options`, and source the GitHub OAuth credentials like below.

```ts
const options = {
  providers: [
    Providers.GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
};
```

OAuth providers typically work the same way, so if your choice is [supported by `next-auth`](https://next-auth.js.org/configuration/providers#built-in-providers), you can configure it the same way as we did with GitHub here. If there is no builtin support, you can still [define a custom provider](https://next-auth.js.org/configuration/providers#using-a-custom-provider).

### Step 3.2: Set up passwordless Email authentication

To allow users to authenticate with magic link Emails, you will need to have access to an SMTP server. These kinds of Emails are considered transactional Emails. If you don't have your own SMTP server or your mail provider has strict restrictions regarding outgoing Emails, you can consider using [Amazon SES](http://aws.amazon.com/ses/), [SendGrid](https://sendgrid.com/), [Mailgun](http://mailgun.com/) or others.

When you have your SMTP credentials ready, you can put that information into the `.env` file, add a `Providers.Email({})` to the list of providers, and source the environment variables like below.

```ts
const options = {
  providers: [
    // Providers.GitHub ...
    Providers.Email({
      server: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      },
      from: process.env.SMTP_FROM, // The "from" address that you want to use
    }),
  ],
};
```

### Step 3.3: Link up Prisma

The final step for setting up `next-auth` is to tell it to use Prisma to talk to the database. For this, we will use the Prisma adapter and add it to the `options` object. We will also need a _secret_ key to sign and encrypt tokens and cookies for `next-auth` to work securely - this _secret_ should also be sourced from environment variables.

```ts
const options = {
  providers: [
    // ...
  ],
  adapter: Adapters.Prisma.Adapter({ prisma }),
  secret: process.env.SECRET,
};
```

To summarize, your `pages/api/auth/[...nextauth].ts` should look like the following:

```ts
import { NextApiHandler } from "next";
import NextAuth from "next-auth";
import Providers from "next-auth/providers";
import Adapters from "next-auth/adapters";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const authHandler: NextApiHandler = (req, res) => NextAuth(req, res, options);
export default authHandler;

const options = {
  providers: [
    Providers.GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
    Providers.Email({
      server: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      },
      from: process.env.SMTP_FROM,
    }),
  ],
  adapter: Adapters.Prisma.Adapter({
    prisma,
  }),

  secret: process.env.SECRET,
};
```

## Step 4: Implement authentication on the frontend

In the application, you can use `next-auth` to check if a visitor has cookies/tokens corresponding to a valid session. If no session can be found, then it means the user is not logged in.

With `next-auth`, you have 2 options for checking the sessions - it can be done inside a React component using the `useSession()` hook, or on the backend (`getServerSideProps` or in API routes) with the helper function `getSession()`.

Let's have a look at how it works.

### Step 4.1: Checking user sessions with the `useSession()` hook

In order to use the hook, you'll need to wrap the component inside a `next-auth` _provider_. For the authentication flow to work anywhere in your entire Next.js app, create a [new file called `/pages/_app.tsx`](https://nextjs.org/docs/advanced-features/custom-app).

```tsx
import { Provider } from "next-auth/client";
import { AppProps } from "next/app";

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <Provider session={pageProps.session}>
      <Component {...pageProps} />
    </Provider>
  );
};

export default App;
```

Now, you can go to `/pages/index.tsx`, and import the `useSession` hook from the `next-auth/client` module. You will also need the `signIn` and `signOut`functions to implement the authentication interaction. The`signIn` function will redirect users to a login form, which is automatically generated by `next-auth`.

```tsx
import { signIn, signOut, useSession } from "next-auth/client";
```

The `useSession()` hook returns an array with the first element being the user session, and the second one a boolean indicating the loading status.

```tsx
// ...
const IndexPage = () => {
  const [session, loading] = useSession();

  if (loading) {
    return <div>Loading...</div>;
  }
};
```

If the `session` object is `null`, it means the user is not logged in. Additionally, we can obtain the user information from `session.user`.

```tsx
// ...
if (session) {
  return (
    <div>
      Hello, {session.user.email ?? session.user.name} <br />
      <button onClick={() => signOut()}>Sign out</button>
    </div>
  );
} else {
  return (
    <div>
      You are not logged in! <br />
      <button onClick={() => signIn()}>Sign in</button>
    </div>
  );
}
```

The finished `/pages/index.tsx` file should look like the following.

```tsx
import { signIn, signOut, useSession } from "next-auth/client";

const IndexPage = () => {
  const [session, loading] = useSession();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (session) {
    return (
      <div>
        Hello, {session.user.email ?? session.user.name} <br />
        <button onClick={() => signOut()}>Sign out</button>
      </div>
    );
  } else {
    return (
      <div>
        You are not logged in! <br />
        <button onClick={() => signIn()}>Sign in</button>
      </div>
    );
  }
};

export default IndexPage;
```

Now, you can spin up the Next.js dev server and play with the authentication flow!

### Step 4.2: Checking user sessions with `getSession()` on the backend

To get user sessions from the backend code, inside either `getServerSideProps()` or an API request handler, you will need to use the `getSession()` async function.

Let's create a new `/pages/api/secret.ts` file for now like below. The same principles from the frontend apply here - if the user doesn't have a valid session, then it means they are not logged in, in which case we will return a message with a [403 status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/403).

```ts
import { NextApiHandler } from "next";
import { getSession } from "next-auth/client";

const secretHandler: NextApiHandler = async (req, res) => {
  const session = await getSession({ req });
  if (session) {
    res.end(
      `Welcome to the VIP club, ${session.user.name || session.user.email}!`
    );
  } else {
    res.statusCode = 403;
    res.end("Hold on, you're not allowed in here!");
  }
};

export default secretHandler;
```

Go visit `localhost:3000/api/secret` without logging in, and you will see something like in the following image.

![403 error if the user is not logged in](https://i.imgur.com/74G5s1J.png)<figcaption>403 error if the user is not logged in</figcaption>

## Conclusion

**And that's it, authentication is so much easier with `next-auth`!**

![High five gif](https://media.giphy.com/media/Ll37bXYmQecEdBpmmM/giphy.gif)

I hope you have enjoyed this tutorial and have learned something useful! You can always find the starter code and the completed project in [this GitHub repo](https://github.com/hexrcs/prisma-next-auth).

Also, check out the [Awesome Prisma list](https://github.com/catalinmiron/awesome-prisma) for more tutorials and starter projects in the Prisma ecosystem!
