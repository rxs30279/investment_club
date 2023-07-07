from django.shortcuts import render
from .models import Mesi_model
import pandas as pd
from plotly.offline import plot
import plotly.express as px
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor
from django.contrib import messages

"""
1. The code imports necessary modules and libraries, including Django, pandas, plotly, yfinance, and ThreadPoolExecutor.

2. The `Profile` function is a Django view function that handles the HTTP request and generates the response. It takes the `request` object as a parameter.

3. Inside the `Profile` function:
   - The function retrieves data from the `Mesi_model` model using the `Mesi_model.objects.all()` queryset.
   - It extracts relevant information from the queryset and creates a list of dictionaries called `holdings_data`.
   - The `holdings_data` list is then used to create a pandas DataFrame called `df`.

4. The function calls the `search_stock_batch` function to fetch stock prices from Yahoo Finance based on the EPIC (Exchange Product Identifier) values in the DataFrame. The `search_stock_batch` function uses a ThreadPoolExecutor to concurrently search for multiple stock prices.

5. The stock prices obtained from Yahoo Finance are added to the DataFrame as a new column called "price".

6. Several calculations are performed on the DataFrame to calculate the following:
   - The current value of each holding (`Value Now`) based on the number of shares held and the current stock price.
   - The gain or loss (`Gain-Loss`) for each holding by subtracting the total cost from the current value.
   - The percentage gain or loss (`Percentage`) for each holding.
   - The overall percentage gain or loss (`Overall_percentage`) for all holdings combined.
   - The current overall value of the portfolio (`Current_value`) by summing the "Value Now" column.

7. The code uses the plotly library to create interactive visualizations:
   - `fig1`: A grouped bar chart showing the total overall cost, value now, and gain-loss for each company in the portfolio.
   - `fig1a`: A bar chart showing the percentage gain or loss for each company in the portfolio.
   - `fig2`: A sunburst chart showing the distribution of the portfolio value by industry sector and index.

8. The plots (`fig1`, `fig1a`, and `fig2`) are customized with layout settings, such as font, title, colors, and axis labels.

9. The `plot` function from the plotly.offline module is used to convert the plots into HTML div elements.

10. The function creates a context dictionary containing the calculated values (`Current_value` and `Overall_percentage`) and the HTML div elements (`plot_div1`, `plot_div1a`, and `plot_div2`).

11. Finally, the function renders the "profile.html" template with the context dictionary as the data for rendering the page.

The code essentially retrieves data from the database, performs calculations and data manipulation using pandas, fetches stock prices from Yahoo Finance, creates visualizations using plotly, and renders the resulting data and visualizations in an HTML template.
"""

def Profile(request):
    # Extract relevant information from the queryset and create a list of dictionaries in 'holdings_data'
    qs = Mesi_model.objects.all()
    holdings_data = [
        {
            "Company": x.company,
            "Total Overall Cost": x.total_cost,
            "Holding": x.holding,
            "Industry": x.industry,
            "Index": x.index,
            "EPIC": x.epic,
        }
        for x in qs
    ]
    # Dataframe creation and calculations
    df = pd.DataFrame(holdings_data)
    
    # Fetch the stock price from yahoo finance
    try:
        yahoo = search_stock_batch(df["EPIC"])
       
    except Exception as e:
        data = {
            "Error": "There has been some error. Please try again later."
        }
       
    
    Price = []
    try:
        for stock in yahoo:
            try:
                # extract the desired price item from each dictionary in yahoo
                current_price = stock["currentPrice"]
                Price.append(current_price)
            except KeyError:
                # Handle the case where the "currentPrice" key is not present in the dictionary
                Price.append(None)
            except Exception as e:
                  # Handle any other exceptions that may occur
                Price.append(None)
    except Exception as e:
        Price = [] #returns an empty value if error
            

    df_price = pd.DataFrame(Price, columns=["price"]) # Place the price information form yahoo in a df
    df = pd.concat([df, df_price], axis=1) # Add in the price df ('df_price') to the original dataframe 'df'
    # df["Total Overall Cost"] =  df["Total Overall Cost"] * 1.015  # Tried to re-adjust the purchase price to include tax etc
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
    # Calc current overall value, sum the 'Value Now' column
    Current_value = df["Value Now"].sum()
    
    #### CREATE GRAPHS ############
    # Create a grouped bar chart to represent Total Overall Cost, Value Now, and Gain-Loss
    fig1 = px.bar(
        df,
        x="Company",
        y=["Total Overall Cost", "Value Now", "Gain-Loss"],
        labels={"Company": "Company Name"},
        title="Profit and Loss Profile",
        color_discrete_map={  # replaces default color mapping by value
            "Total Overall Cost": "#2c697a",
            "Value Now": "#2e8897",
            "Gain-Loss": "#37c8cc",
        },
        barmode="group",
        # height=400,
    ).update_xaxes(categoryorder="total descending")

    fig1.update_layout(  # customize font and legend orientation & position
        yaxis=dict(title="Value in UK Pounds",ticks="outside",tickwidth=0, tickcolor='#020024',  ticklen=10,showgrid=False,tickprefix="£"),
        font = dict(family="Roboto", size=15, color="#2e8897"), #color blue 2
        plot_bgcolor='rgba(0,0,0,0)',  # Transparent background
        paper_bgcolor='rgba(0,0,0,0.01)',  # Semi-transparent background
        title_x=0.5,
        title_y=0.97,
        legend=dict(title=None, orientation="h", y=1, yanchor="bottom", x=0.5, xanchor="center"),
    ).update_xaxes(categoryorder="min descending")
    
    # fig1.update_yaxes(tickprefix="£")
    # fig1.update_yaxes(showgrid=False,tickprefix="£")

    color_map = {True: "#37c8cc", False: "#2c697a"}
    
    fig1a = px.bar(
        df,
        x="Company",
        y=["Percentage"],
        labels={"Company": "Company Name"},
        color=df["Percentage"] > 0,
        color_discrete_map=color_map,
        # height=400,
    ).update_xaxes(categoryorder="min descending")

    fig1a.update_layout(
        title_text="Percentage Gain and Loss",
        title_x=0.5,
        title_y=0.97,
        font = dict(family="Roboto", size=15, color="#2e8897"), #color blue 2
        plot_bgcolor='rgba(0,0,0,0)',  # Transparent background
        paper_bgcolor='rgba(0,0,0,0.01)',  # Semi-transparent background
        showlegend=False,
        template="plotly_white",
        yaxis=dict(title="Percentage", ticksuffix="%",ticks="outside",tickwidth=0, tickcolor='#020024',  ticklen=10,showgrid=False),
    )
    fig2 = px.sunburst(
        df,
        color="Industry",
        values="Value Now",
        path=["Index", "Industry"],
        hover_name="Company",
       
    )
    fig2.update_layout(  # customize font and legend orientation & position
        font = dict(family="Roboto", size=15), #color blue 2
        title="Portfolio: By Industy Sector <br><sup>Area is proportional to current sector value</sup>",
        title_font_color="#2e8897",
        plot_bgcolor='rgba(0,0,0,0)',  # Transparent background
        paper_bgcolor='rgba(0,0,0,0.01)',  # Semi-transparent background
        title_x=0.5,
        title_y=0.95,
        height = 600,
       
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

############## Functions ########################

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
