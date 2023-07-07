from django.shortcuts import render
from .models import SharesModel,UsersModel
import pandas as pd


import yfinance as yf
from concurrent.futures import ThreadPoolExecutor


import plotly.offline as plot
import plotly.express as px
import plotly.io as pio
from plotly.offline import plot

# Create your views here.


def Competition(request):
    # Extract relevant information from the queryset and create a list of dictionaries in 'holdings_data'
    qs = SharesModel.objects.all()
    holdings_data = [
        {
            "Starting Price": x.purchase_price,
            "Holdings": x.shares,
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
        
    
    df_price = pd.DataFrame({"price" : Price}) # Place the price information from yahoo in a df
    
    df = pd.concat([df, df_price], axis=1) # Add in the price df ('df_price') to the original dataframe 'df'

    df["Value Now"] = (df["Holdings"] * df["price"])  # calc Value Now
    df["Original Cost"] = df["Starting Price"] * df["Holdings"]  # calc Original Cost
    df["Gain-Loss"] = df["Value Now"] - df["Original Cost"]  # calc Gain 
    df['Percentage Gain'] = df["Gain-Loss"] / df["Original Cost"] *100
    
    # df_members = pd.DataFrame(columns=["First Name","Last Name","EPIC_id"])

# Iterate over each member
    qt = UsersModel.objects.all()
    member_data = [ 
            {
            "First Name": x.firstname,
            "Last Name": x.lastname,
            "EPIC_id":  list(x.ftse_id.values_list("epic", flat=True)),
            } 
        for x in qt 
    ]
        # Append member data to the DataFrame
    df_members =  pd.DataFrame(member_data)
    df_members_exploded = df_members.explode("EPIC_id")

    df = pd.merge(df_members_exploded, df, left_on="EPIC_id", right_on="EPIC", how="inner")
    
   
    member_summary = df.groupby([ "First Name", "Last Name"]).agg(
        # First_Name=("First Name", "first"),
        # Last_Name=("Last Name", "first"),
        Overall_Cost = ("Original Cost", "sum"),
        Overall_Gain = ("Gain-Loss", "sum"),
        Value_Now = ("Value Now","sum"),
    ).reset_index()
    
    member_summary["Overall Gain %"] = (member_summary["Overall_Gain"] / member_summary["Overall_Cost"]) * 100
   
   
   
  #### CREATE GRAPHS ############
  
   # Create a grouped bar chart to represent Total Overall Cost, Value Now, and Gain-Loss
    color_map = {True: "#30a7b3", False: "#20323c"}
    fig1 = px.bar(
        member_summary,
        x="First Name",
        y=["Overall Gain %"],
        title = "Competition Members (Percent)",
        color= member_summary["Overall_Gain"] > 0,
        color_discrete_map= color_map,
        labels = {'First Name'},  
        hover_data= {'Value_Now'}, # Add 'value now' as hover information        
    ).update_xaxes(categoryorder="min descending")
    
    fig1.update_layout(
    showlegend=False,  
    yaxis=dict(title="Percentage " ,ticks="outside",tickwidth=0, tickcolor='#020024',  ticklen=15,color="#2e8897",showgrid=False,ticksuffix="%"),
    xaxis=dict(title =""),
    font=dict(family="Roboto", size=15, color="#2e8897"),#color blue 2
    plot_bgcolor='rgba(0,0,0,0)',  # Transparent background
    paper_bgcolor='rgba(0,0,0,0.01)',  # Semi-transparent background
    
    )
   
   
    
    # bar = plot(fig1, include_plotlyjs=False, output_type="div", config={"displayModeBar": False})
    bar = plot(fig1, output_type="div")
   
    # Plot iterative graphs for each member of percentage gain/loss
    plot_divs = []
    # Define spacing between the graphs
    graph_spacing = 150  # Adjust this value as needed
    # Iterate over each member
    for member in df["First Name"].unique():
        member_data = df[df["First Name"] == member]
        member_name = member_data["First Name"].iloc[0]  # Assuming there is a column named "Member Name" in the DataFrame
        # Create a plotly bar chart for the member's holdings using Plotly Express
        fig = px.bar(member_data, x="EPIC_id", y="Percentage Gain",
                    title=f"{member_name}'s Competition Entries",
                    color= member_data["Percentage Gain"] > 0,
                    color_discrete_map=color_map,
                    hover_data= {'Value Now'}, # Add 'value now' as hover information        
                    
                    ).update_xaxes(categoryorder="min descending")
                   

        fig.update_layout(
            showlegend=False,
            font=dict(family="Roboto", size=15, color="#2e8897"),
            plot_bgcolor='rgba(0,0,0,0)',  # Transparent background
            yaxis=dict(title = "Percentage" ,ticks="outside",tickwidth=0, tickcolor='#020024',  ticklen=15, ticksuffix="%"),
            xaxis=dict(title =""),
            paper_bgcolor='rgba(0,0,0,0.01)',  # Semi-transparent background
            margin=dict(t=graph_spacing),  # Add spacing between the graphs
        )
        fig.update_yaxes(showgrid=False)
        
        # Render the plotly graph as HTML div
        plot_div = plot(fig, auto_open=False, output_type="div")
        #Remove plotly control panel - but loose some of the jscript elements
        #plot_div = plot(fig, include_plotlyjs=False, output_type="div", config={"displayModeBar": False})
        # Append the plot div to the list
        plot_divs.append(plot_div)

    context = {
        "plot_div1": bar,
        "plot_divs": plot_divs
        
    }

    return render(request, "competition.html", context)

 
    
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



