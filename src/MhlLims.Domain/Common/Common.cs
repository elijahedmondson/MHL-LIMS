namespace MhlLims.Domain.Common;

/// <summary>
/// A business rule was broken. The message is written for lab staff and is safe to show in the UI.
/// </summary>
public sealed class DomainException(string message) : Exception(message);

/// <summary>Entities whose ModifiedBy column is stamped with the signed-in user on every save.</summary>
public interface IHasModifiedBy
{
    string ModifiedBy { get; set; }
}

/// <summary>
/// Money arithmetic. Amounts are rounded half away from zero to two places, which is what
/// SQL Server's ROUND() does for the persisted Amount columns, so C# and the database agree.
/// </summary>
public static class Money
{
    public static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    public static decimal Amount(decimal units, decimal unitPrice) => Round(units * unitPrice);
}
