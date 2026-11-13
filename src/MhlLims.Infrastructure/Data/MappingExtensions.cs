using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MhlLims.Infrastructure.Data;

/// <summary>Shared mapping helpers.</summary>
internal static class MappingExtensions
{
    /// <summary>Maps an enum to its upper-case name, matching the CHECK constraints (e.g. Pending -> PENDING).</summary>
    public static PropertyBuilder<TEnum> HasUpperCaseEnumConversion<TEnum>(this PropertyBuilder<TEnum> property, int maxLength)
        where TEnum : struct, Enum
    {
        var converter = new ValueConverter<TEnum, string>(
            v => v.ToString().ToUpperInvariant(),
            v => Enum.Parse<TEnum>(v, true));
        return property.HasConversion(converter).HasMaxLength(maxLength);
    }

    /// <summary>
    /// Maps an enum to upper snake case, matching CHECK constraints such as NOT_EXAMINED or BETA_GAL
    /// (NotExamined -> NOT_EXAMINED, BetaGal -> BETA_GAL). Single-word values are the same as HasUpperCaseEnumConversion.
    /// </summary>
    public static PropertyBuilder<TEnum> HasSnakeCaseEnumConversion<TEnum>(this PropertyBuilder<TEnum> property, int maxLength)
        where TEnum : struct, Enum
        => property.HasConversion(SnakeCaseConverter<TEnum>()).HasMaxLength(maxLength);

    /// <summary>The same for a nullable enum column (EF never passes NULL to a converter).</summary>
    public static PropertyBuilder<TEnum?> HasSnakeCaseNullableEnumConversion<TEnum>(this PropertyBuilder<TEnum?> property, int maxLength)
        where TEnum : struct, Enum
        => property.HasConversion(SnakeCaseConverter<TEnum>()).HasMaxLength(maxLength);

    private static ValueConverter<TEnum, string> SnakeCaseConverter<TEnum>() where TEnum : struct, Enum =>
        new(v => ToSnake(v.ToString()), v => Enum.Parse<TEnum>(v.Replace("_", string.Empty), true));

    public static string ToSnake(string name)
    {
        var sb = new System.Text.StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            if (i > 0 && char.IsUpper(name[i])) sb.Append('_');
            sb.Append(char.ToUpperInvariant(name[i]));
        }
        return sb.ToString();
    }

    /// <summary>
    /// Maps a system-versioned table. Period columns are HIDDEN in SQL and are shadow properties here.
    /// Triggers must be declared so EF does not use OUTPUT without INTO (not allowed on tables with triggers).
    /// </summary>
    public static EntityTypeBuilder<T> ToTemporalTable<T>(this EntityTypeBuilder<T> builder, string table, string schema, params string[] triggers)
        where T : class
    {
        builder.ToTable(table, schema, tb =>
        {
            tb.IsTemporal(t =>
            {
                t.HasPeriodStart("ValidFrom");
                t.HasPeriodEnd("ValidTo");
                t.UseHistoryTable(table, "history");
            });
            foreach (var trigger in triggers) tb.HasTrigger(trigger);
        });
        return builder;
    }

    /// <summary>A persisted computed column whose value EF reads back but never writes.</summary>
    public static PropertyBuilder<decimal> IsPersistedAmount(this PropertyBuilder<decimal> property, string sql)
    {
        property.HasComputedColumnSql(sql, stored: true).HasPrecision(12, 2);
        property.Metadata.SetBeforeSaveBehavior(PropertySaveBehavior.Ignore);
        property.Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
        return property;
    }
}
