from django.shortcuts import render
from .models import Mesi_model
import pandas as pd
from plotly.offline import plot
import plotly.express as px
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor


def search_stock(stock_ticker):
    try:
        data = yf.Ticker(stock_ticker).info
        if data["symbol"] == stock_ticker:
            return data
        else:
            data = {
                "Error": "There was a problem with your provided ticker symbol. Please try again"
            }
    except Exception as e:
        data = {
            "Error": "There has been some connection error. Please try again later."
        }
    return data


def search_stock_batch(stock_tickers):
    results = {}
    with ThreadPoolExecutor() as executor:
        results = list(executor.map(search_stock, stock_tickers))
    return results


def Profile(request):
    qs = Mesi_model.objects.all()
    holdings_data = [
        {
            "Company": x.company,
            "Total Overall Cost": x.total_cost,
            "Holding": x.holding,
            # "Value Now": x.value_now,
            # "Gain-Loss": x.gain_loss,
            "Industry": x.industry,
            "Index": x.index,
            "EPIC": x.epic,
        }
        for x in qs
    ]
    # Dataframe creation and calculations
    df = pd.DataFrame(holdings_data)

    # Fetch the stock price from yahoo finance
    yahoo = search_stock_batch(df["EPIC"])

    Price = []
    for stock in yahoo:
        # extract the desired price item from each dictionary in yahoo
        current_price = stock["currentPrice"]
        Price.append(current_price)

    df_price = pd.DataFrame(Price, columns=["price"])
    df = pd.concat([df, df_price], axis=1)

    df["Value Now"] = (df["Holding"] * df["price"]) / 100  # calc Value Now
    df["Gain-Loss"] = df["Value Now"] - df["Total Overall Cost"]  # calc Gain Loss

    # Calc percentage gain loss
    df["Percentage"] = (
        (df["Value Now"] - df["Total Overall Cost"]) / df["Total Overall Cost"]
    ) * 100
    # Calc overall percentage gain loss
    Overall_percentage = (
        (df["Value Now"].sum() - df["Total Overall Cost"].sum())
        / df["Total Overall Cost"].sum()
    ) * 100
    # Calc current overall value, sum the column
    Current_value = df["Value Now"].sum()

    fig1 = px.bar(
        df,
        x="Company",
        y=["Total Overall Cost", "Value Now", "Gain-Loss"],
        labels={"Company": "Company Name"},
        color_discrete_map={  # replaces default color mapping by value
            "Total Overall Cost": "RebeccaPurple",
            "Value Now": "MediumPurple",
            "Gain-Loss": "#669932",
        },
        barmode="group",
        height=400,
    ).update_xaxes(categoryorder="min descending")

    fig1.update_layout(  # customize font and legend orientation & position
        font=dict(family="Arial", size=15),
        title_text="Profit and Loss Profile",
        title_x=0.5,
        title_y=0.97,
        template="plotly_white",
        yaxis=dict(
            title="Value in UK Pounds",
        ),
        legend=dict(
            title=None, orientation="h", y=1, yanchor="bottom", x=0.5, xanchor="center"
        ),
    )
    fig1.update_yaxes(
        tickprefix="£",
        showgrid=True,
    )

    color_map = {True: "#15E8E5", False: "#e91417"}
    fig1a = px.bar(
        df,
        x="Company",
        y=["Percentage"],
        labels={"Company": "Company Name"},
        color=df["Percentage"] > 0,
        color_discrete_map=color_map,
        height=400,
    ).update_xaxes(categoryorder="min descending")

    fig1a.update_layout(
        font=dict(family="Arial", size=15),
        title_text="Percentage Gain and Loss",
        title_x=0.5,
        title_y=0.97,
        showlegend=False,
        template="plotly_white",
        yaxis=dict(title="Percentage", ticksuffix="%"),
    )
    fig2 = px.sunburst(
        df,
        color="Industry",
        values="Value Now",
        path=["Index", "Industry"],
        color_discrete_sequence=px.colors.qualitative.Dark24,
        hover_name="Company",
        height=700,
    )
    fig2.update_layout(  # customize font and legend orientation & position
        font=dict(family="Arial", size=15, color="black"),
        title="Portfolio: By Industy Sector <br><sup>Area is proportional to current sector value</sup>",
        title_x=0.5,
        title_y=0.95,
        template="plotly_white",
    )

    grouped_bar = plot(fig1, output_type="div")
    percentage = plot(fig1a, output_type="div")
    sunburst = plot(fig2, output_type="div")
    context = {
        "Current_value": Current_value,
        "Overall_percentage": Overall_percentage,
        "plot_div1": grouped_bar,
        "plot_div1a": percentage,
        "plot_div2": sunburst,
    }
    return render(request, "profile.html", context)
