using MhlLims.Infrastructure.Data;
using Microsoft.AspNetCore.Components.Authorization;

namespace MhlLims.Web;

/// <summary>
/// Resolves the signed-in AD account for the data layer. During the first HTTP request the
/// HttpContext is available; inside an interactive Blazor circuit it is not, so the circuit's
/// authentication state is used instead.
/// </summary>
public sealed class SignedInUser(IHttpContextAccessor httpContextAccessor, AuthenticationStateProvider authenticationStateProvider) : ICurrentUser
{
    public string AccountName
    {
        get
        {
            var name = httpContextAccessor.HttpContext?.User.Identity?.Name;
            if (!string.IsNullOrWhiteSpace(name)) return name;
            try
            {
                var state = authenticationStateProvider.GetAuthenticationStateAsync();
                return state.IsCompletedSuccessfully ? state.Result.User.Identity?.Name ?? "unknown" : "unknown";
            }
            catch (InvalidOperationException)
            {
                // No HTTP request and no Blazor circuit, e.g. a background sync job.
                return "system";
            }
        }
    }
}
