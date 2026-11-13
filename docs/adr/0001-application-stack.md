# ADR 0001: Application stack

**Status:** Accepted (lab decision, 3 November 2026)

## Context
MHL will build its own LIMS with in-house developers. The institution already runs SQL Server, SSRS and Windows (AD) sign-on, and C&SS's Zaphod is written in .NET.

## Decision
- ASP.NET Core on **.NET 10 (LTS, supported to November 2028)**, with **Blazor Server** for the user interface, so a small team works in one language.
- **SQL Server** for the database; **EF Core 10** for data access.
- **Windows authentication (Negotiate)** for NIH single sign-on, with AD groups mapped to application roles.
- Business rules in a dependency-free `Domain` project, tested with xUnit.

## Consequences
- The team must plan the move to the next LTS release (.NET 12, expected November 2027) during 2028.
- Blazor Server keeps a live connection per user; pages should use short-lived DbContexts (`IDbContextFactory`).
- If the sign-on approach changes to OpenID Connect (Entra ID), only `Program.cs` and `SignedInUser` change.
